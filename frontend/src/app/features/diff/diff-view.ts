import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type * as Monaco from 'monaco-editor';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Change, FileDiff, Hunk, Part, Picked, Where } from '../../core/models/repository';
import { DiffLayout, DiffMode, Preferences } from '../../core/models/settings';
import { PreferencesService } from '../../core/services/preferences.service';
import { OpenDiff, RepositoryService } from '../../core/services/repository.service';
import { ENCODINGS, Encoding, decode, guessEncoding } from '../../shared/encoding';
import {
  MonacoApi,
  codeLook,
  codeModel,
  editorOptions,
  injectMonaco,
  restyle,
  zoneBar,
} from '../../shared/monaco';
import { reaches } from '../../shared/ancestry';
import { MenusService } from '../repository-tab/menus.service';
import { ImageDiff, isImage } from './image-diff';

type CodeEditor = Monaco.editor.ICodeEditor;

/** The file a diff is about: a change, and where it lies. */
interface Target {
  change: Change;
  where: Where;
}

/** A change's file before and after it, as bytes; none where it is not. */
interface Versions {
  target: Target;
  old: Uint8Array | null;
  new: Uint8Array | null;
}

/** An editor and what it shows, to change only what has to. */
interface Shown {
  mode: DiffMode;
  /** Its own layer of the editor's area: a new diff is laid out unseen, under the old one. */
  pane: HTMLElement;
  editor: Monaco.editor.IStandaloneCodeEditor | Monaco.editor.IStandaloneDiffEditor;
  path: string | null;
  texts: { old: string; new: string } | null;
  models: Monaco.editor.ITextModel[];
  decorations: Monaco.editor.IEditorDecorationsCollection | null;
  /** The bars above the hunks, in each editor they are in. */
  bars: { editor: CodeEditor; ids: string[] }[];
}

/** How long a new diff may take before it shows anyway. */
const DIFF_WAIT_MS = 400;

const LAYOUTS: Record<DiffLayout, Monaco.editor.IDiffEditorOptions> = {
  hunks: {
    renderSideBySide: false,
    hideUnchangedRegions: {
      enabled: true,
      contextLineCount: 3,
      minimumLineCount: 3,
      revealLineCount: 20,
    },
  },
  inline: { renderSideBySide: false, hideUnchangedRegions: { enabled: false } },
  split: { renderSideBySide: true, hideUnchangedRegions: { enabled: false } },
};

/**
 * A file's changes in VS Code's editor: the whole file with its changes marked, or the
 * changes alone, inline or side by side; its bytes read in the encoding chosen.
 */
@Component({
  selector: 'app-diff-view',
  templateUrl: './diff-view.html',
  styleUrl: './diff-view.scss',
  imports: [TPipe, ImageDiff],
})
export class DiffView {
  protected readonly repository = inject(RepositoryService);
  private readonly menus = inject(MenusService);
  private readonly preferences = inject(PreferencesService);
  protected readonly prefs = this.preferences.preferences;
  /** Whether this view shows the repository's diff: one kept out of sight follows none. */
  readonly follows = input(true);
  protected readonly open = computed(() => (this.follows() ? this.repository.diff() : null));
  /** The diff on screen, or the last one while out of sight: its editor stays for the next. */
  protected readonly current = linkedSignal<OpenDiff | null, OpenDiff | null>({
    source: this.open,
    computation: (open, previous) => open ?? previous?.value ?? null,
  });
  protected readonly encodings = ENCODINGS;
  /** The encoding picked for this file; guessed until then. */
  protected readonly picked = signal<Encoding | null>(null);
  private readonly loaded = injectMonaco();
  private readonly monaco = this.loaded.monaco;
  private readonly readFailure = signal<string | null>(null);
  protected readonly failure = computed(() => this.loaded.failure() ?? this.readFailure());
  private readonly versions = signal<Versions | null>(null);
  private readonly host = viewChild<ElementRef<HTMLElement>>('editor');
  private shown: Shown | null = null;
  /** The diff still on screen while the one replacing it is computed. */
  private leaving: Shown | null = null;

  protected readonly where = computed(() => {
    const where = this.open()?.where;
    if (!where) return '';
    if (where.kind === 'commit') return t('In commit {id}', { id: where.id.slice(0, 7) });
    if (where.kind === 'stash') return t('In a stash');
    if (where.kind === 'compare') {
      const comparison = this.repository.comparison();
      return comparison ? `${comparison.from.name} → ${comparison.to.name}` : '';
    }
    return where.kind === 'staged' ? t('Staged') : t('Unstaged');
  });

  /** What the hunks, or lines picked, can become: none in a commit or a stash. */
  protected readonly parts = computed<Part[]>(() => {
    const open = this.open();
    if (!open?.diff || open.diff.binary || open.change.kind === 'conflicted') return [];
    if (open.where.kind === 'staged') return ['unstage'];
    // what the branch checked out has, only, can be taken back out of its files
    const commits = this.repository.snapshot()?.commits ?? [];
    const head = this.repository.headId();
    if (open.where.kind === 'commit' || open.where.kind === 'compare') {
      const last = open.where.kind === 'commit' ? open.where.id : open.where.to;
      return reaches(commits, head, last) ? ['revert'] : [];
    }
    if (open.where.kind !== 'unstaged') return [];
    return open.change.kind === 'untracked' ? ['stage'] : ['stage', 'discard'];
  });

  /** The changed lines the selection covers. */
  protected readonly selected = signal<Picked[]>([]);

  protected readonly counts = computed(() => {
    let added = 0;
    let removed = 0;
    for (const hunk of this.open()?.diff?.hunks ?? []) {
      for (const line of hunk.lines) {
        if (line.kind === 'added') added++;
        else if (line.kind === 'removed') removed++;
      }
    }
    return { added, removed };
  });

  /** The file the diff is about; the same while only its lines are read again. */
  private readonly target = computed<Target | null>(
    () => {
      const open = this.open();
      return open ? { change: open.change, where: open.where } : null;
    },
    { equal: (a, b) => a?.change === b?.change && a?.where.kind === b?.where.kind },
  );

  protected readonly guessed = computed(() => {
    const v = this.versions();
    return v ? guessEncoding(v.new ?? v.old ?? new Uint8Array()) : 'utf-8';
  });
  protected readonly encoding = computed(() => this.picked() ?? this.guessed());
  protected readonly ready = computed(() => !!this.versions() && !!this.monaco());
  /** A file only one side has, added or deleted: shown whole, there is nothing to compare. */
  protected readonly whole = computed(() => {
    const v = this.versions();
    return !!v && (!v.old || !v.new);
  });
  /** How the file is shown: as the settings say, a whole file always in the file view. */
  protected readonly mode = computed<DiffMode>(() =>
    this.whole() ? 'file' : this.prefs().diffMode,
  );
  /** The versions of an image, shown as images rather than as text. */
  protected readonly image = computed(() => {
    const v = this.versions();
    return v && isImage(v.target.change.path) ? v : null;
  });

  private readonly texts = computed(() => {
    const v = this.versions();
    if (!v || this.image()) return null;
    const encoding = this.encoding();
    const text = (bytes: Uint8Array | null) => (bytes ? decode(bytes, encoding) : '');
    return { old: text(v.old), new: text(v.new) };
  });

  constructor() {
    effect(() => {
      const target = this.target();
      untracked(() => this.read(target));
    });
    effect(() => {
      const monaco = this.monaco();
      const host = this.host()?.nativeElement;
      const texts = this.texts();
      const prefs = this.prefs();
      const diff = this.open()?.diff ?? null;
      if (monaco && host && texts) untracked(() => this.show(monaco, host, texts, prefs, diff));
    });
    // the editor made before any diff, while nothing is shown: the first one opens at once
    effect(() => {
      const monaco = this.monaco();
      const host = this.host()?.nativeElement;
      if (monaco && host)
        untracked(() => (this.shown ??= this.create(monaco, host, this.prefs(), this.mode())));
    });
    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  @HostListener('document:keydown.escape', ['$event'])
  protected escape(event: Event) {
    if (!this.open()) return;
    // Escape in the editor's search closes the search first
    if ((event.target as HTMLElement).closest('.find-widget')) return;
    if (!this.repository.active()) return;
    // the file panel this diff may sit in stays
    event.preventDefault();
    this.close();
  }

  protected close() {
    this.repository.diff.set(null);
  }

  protected set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    this.preferences.set(key, value);
  }

  /** Stages, unstages or throws away `lines`; throwing them away is asked first. */
  protected applyLines(part: Part, lines: Picked[]) {
    const open = this.open();
    const file = open?.change.path;
    if (!open || !file) return;
    if (part === 'revert') {
      void this.repository.revertLines(file, open.where, lines);
      return;
    }
    if (part !== 'discard') {
      void this.repository.applyLines(file, part, lines);
      return;
    }
    this.menus.ask({
      title: t('Discard these changes?'),
      text: t('The lines go back as they are staged, or committed; Undo brings them back.'),
      fields: [],
      confirm: t('Discard'),
      danger: true,
      answered: () => void this.repository.applyLines(file, part, lines),
    });
  }

  protected partLabel(part: Part) {
    const labels: Record<Part, () => string> = {
      stage: () => t('Stage lines'),
      unstage: () => t('Unstage lines'),
      discard: () => t('Discard lines'),
      revert: () => t('Revert lines'),
    };
    return labels[part]();
  }

  protected pickEncoding(value: string) {
    this.picked.set(value === 'guess' ? null : (value as Encoding));
  }

  /** Moves to the next change, or the previous one, going round. */
  protected go(next: boolean) {
    const shown = this.shown;
    if (!shown) return;
    if (shown.mode === 'diff') {
      (shown.editor as Monaco.editor.IStandaloneDiffEditor).goToDiff(next ? 'next' : 'previous');
      return;
    }
    const editor = shown.editor as Monaco.editor.IStandaloneCodeEditor;
    const starts = changeStarts(this.open()?.diff ?? null);
    if (!starts.length) return;
    const at = editor.getPosition()?.lineNumber ?? 0;
    const line = next
      ? (starts.find((l) => l > at) ?? starts[0])
      : ([...starts].reverse().find((l) => l < at) ?? starts[starts.length - 1]);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.revealLineInCenter(line);
    editor.focus();
  }

  private async read(target: Target | null) {
    const path = this.repository.snapshot()?.path;
    this.readFailure.set(null);
    if (!target || !path) {
      this.versions.set(null);
      return;
    }
    try {
      const buffer = await this.repository.fileVersions(target.change, target.where);
      if (this.target() !== target) return;
      // the last file stays on screen until this one is read
      if (this.versions()?.target.change.path !== target.change.path) this.picked.set(null);
      this.versions.set(split(target, buffer));
    } catch (e) {
      if (this.target() === target) this.readFailure.set(String(e));
    }
  }

  private show(
    monaco: MonacoApi,
    host: HTMLElement,
    texts: { old: string; new: string },
    prefs: Preferences,
    diff: FileDiff | null,
  ) {
    const mode = this.mode();
    if (this.shown?.mode !== mode) {
      this.dispose();
      this.shown = this.create(monaco, host, prefs, mode);
    }
    if (this.shown!.texts !== texts) {
      const path = this.versions()?.target.change.path ?? null;
      if (this.shown!.mode === 'diff') this.replaceDiff(monaco, host, texts, path, prefs);
      else this.replaceFile(monaco, texts, path, prefs);
    }
    const shown = this.shown!;
    restyle(monaco, shown.models, shown.path ?? '', prefs);
    if (shown.mode === 'diff') {
      (shown.editor as Monaco.editor.IStandaloneDiffEditor).updateOptions(diffOptions(prefs));
    } else {
      const editor = shown.editor as Monaco.editor.IStandaloneCodeEditor;
      editor.updateOptions({
        ...codeLook(prefs),
        wordWrap: prefs.wordWrap ? 'on' : 'off',
        mouseWheelScrollSensitivity: prefs.scrollSpeed,
      });
      shown.decorations?.clear();
      const deleted = !this.versions()?.new;
      shown.decorations = editor.createDecorationsCollection(marks(monaco, diff, deleted));
    }
    this.placeBars(shown, diff, prefs);
  }

  /** A bar above each hunk, naming it and what can become of it; its place kept on the other side. */
  private placeBars(shown: Shown, diff: FileDiff | null, prefs: Preferences) {
    for (const { editor, ids } of shown.bars) {
      editor.changeViewZones((zones) => ids.forEach((id) => zones.removeZone(id)));
    }
    shown.bars = [];
    this.selected.set([]);
    const parts = this.parts();
    if (!diff || !parts.length) return;
    const sides: { editor: CodeEditor; old: boolean; bar: boolean }[] = [];
    if (shown.mode === 'diff') {
      const editor = shown.editor as Monaco.editor.IStandaloneDiffEditor;
      sides.push({ editor: editor.getModifiedEditor(), old: false, bar: true });
      if (prefs.diffLayout === 'split')
        sides.push({ editor: editor.getOriginalEditor(), old: true, bar: false });
    } else {
      // a deleted file shows its old lines
      sides.push({ editor: shown.editor as CodeEditor, old: !shown.texts?.new, bar: true });
    }
    for (const side of sides) {
      const ids: string[] = [];
      side.editor.changeViewZones((zones) => {
        for (const hunk of diff.hunks) {
          ids.push(
            zones.addZone({
              afterLineNumber: lineBefore(hunk, side.old),
              heightInPx: 28,
              // under the fold of the lines hidden before it
              ordinal: 1_000_000,
              domNode: side.bar ? this.bar(hunk, parts) : gap(),
            }),
          );
        }
      });
      shown.bars.push({ editor: side.editor, ids });
    }
  }

  private bar(hunk: Hunk, parts: Part[]): HTMLElement {
    const lines = hunk.lines
      .filter((l) => l.kind !== 'context')
      .map((l) => ({
        old: l.kind === 'removed' ? l.old : null,
        new: l.kind === 'added' ? l.new : null,
      }));
    const labels: Record<Part, () => string> = {
      stage: () => t('Stage hunk'),
      unstage: () => t('Unstage hunk'),
      discard: () => t('Discard hunk'),
      revert: () => t('Revert hunk'),
    };
    return zoneBar(
      hunk.header,
      parts.map((part) => ({
        label: labels[part](),
        danger: part === 'discard',
        run: () => this.applyLines(part, lines),
      })),
    );
  }

  /** Follows the selection: the changed lines it covers, on the side it is in. */
  private follow(editor: CodeEditor, old: boolean) {
    editor.onDidChangeCursorSelection(({ selection }) => {
      if (!this.parts().length || selection.isEmpty()) {
        this.selected.set([]);
        return;
      }
      // lines picked whole end at the start of the next one
      const last =
        selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber
          ? selection.endLineNumber - 1
          : selection.endLineNumber;
      this.selected.set(pickedIn(this.open()?.diff ?? null, selection.startLineNumber, last, old));
    });
  }

  /**
   * Lays the new diff out in an editor of its own, unseen, and shows it in place of the
   * old one once computed: never the whole file first, folded a moment later.
   */
  private replaceDiff(
    monaco: MonacoApi,
    host: HTMLElement,
    texts: { old: string; new: string },
    path: string | null,
    prefs: Preferences,
  ) {
    const before = this.shown!;
    const next = before.texts ? this.create(monaco, host, prefs, 'diff') : before;
    const editor = next.editor as Monaco.editor.IStandaloneDiffEditor;
    editor.updateOptions(diffOptions(prefs));
    if (next !== before) {
      // a diff replaced before it showed is dropped: the one on screen stays until the last
      if (this.leaving) this.discard(before);
      else this.leaving = before;
    }
    const original = codeModel(monaco, texts.old, path ?? '', prefs);
    const modified = codeModel(monaco, texts.new, path ?? '', prefs);
    editor.setModel({ original, modified });
    if (path === before.path && before !== next) {
      const state = (before.editor as Monaco.editor.IStandaloneDiffEditor).saveViewState();
      if (state) editor.restoreViewState(state);
    }
    Object.assign(next, { path, texts, models: [original, modified] });
    this.shown = next;
    // unseen and out of the pointer's way; Monaco's lines ignore a parent's visibility
    Object.assign(next.pane.style, { opacity: '0', pointerEvents: 'none' });
    const reveal = (late: boolean) => {
      // the diff is announced once cleared, before it is computed
      if (!late && !editor.getLineChanges()) return;
      updated.dispose();
      clearTimeout(timer);
      if (this.shown !== next) return;
      requestAnimationFrame(() => {
        if (this.shown !== next) return;
        Object.assign(next.pane.style, { opacity: '', pointerEvents: '' });
        if (this.leaving) this.discard(this.leaving);
        this.leaving = null;
      });
    };
    const updated = editor.onDidUpdateDiff(() => reveal(false));
    const timer = setTimeout(() => reveal(true), DIFF_WAIT_MS);
  }

  private replaceFile(
    monaco: MonacoApi,
    texts: { old: string; new: string },
    path: string | null,
    prefs: Preferences,
  ) {
    const shown = this.shown!;
    const editor = shown.editor as Monaco.editor.IStandaloneCodeEditor;
    const state = path === shown.path ? editor.saveViewState() : null;
    // a deleted file has only its old lines to show
    const model = codeModel(monaco, texts.new || texts.old, path ?? '', prefs);
    editor.setModel(model);
    if (state) editor.restoreViewState(state);
    shown.models.forEach((m) => m.dispose());
    Object.assign(shown, { path, texts, models: [model] });
  }

  private create(monaco: MonacoApi, host: HTMLElement, prefs: Preferences, mode: DiffMode): Shown {
    const options = editorOptions(prefs);
    const pane = document.createElement('div');
    pane.style.cssText = 'position: absolute; inset: 0';
    host.append(pane);
    const editor =
      mode === 'diff'
        ? monaco.editor.createDiffEditor(pane, {
            ...options,
            originalEditable: false,
            renderMarginRevertIcon: false,
            renderOverviewRuler: true,
            useInlineViewWhenSpaceIsLimited: false,
          })
        : monaco.editor.create(pane, options);
    if (mode === 'diff') {
      const diff = editor as Monaco.editor.IStandaloneDiffEditor;
      this.follow(diff.getModifiedEditor(), false);
      this.follow(diff.getOriginalEditor(), true);
    } else {
      this.follow(editor as CodeEditor, false);
    }
    return { mode, pane, editor, path: null, texts: null, models: [], decorations: null, bars: [] };
  }

  private dispose() {
    if (this.leaving) this.discard(this.leaving);
    if (this.shown) this.discard(this.shown);
    this.leaving = null;
    this.shown = null;
  }

  private discard(shown: Shown) {
    shown.editor.dispose();
    shown.models.forEach((m) => m.dispose());
    shown.pane.remove();
  }
}

function diffOptions(prefs: Preferences): Monaco.editor.IDiffEditorOptions {
  return {
    ...codeLook(prefs),
    wordWrap: prefs.wordWrap ? 'on' : 'off',
    mouseWheelScrollSensitivity: prefs.scrollSpeed,
    ...LAYOUTS[prefs.diffLayout],
    ignoreTrimWhitespace: prefs.ignoreWhitespace,
  };
}

/** The buffer `file_versions` answers: which versions are there, the old one's length, both. */
function split(target: Target, buffer: ArrayBuffer): Versions {
  const view = new DataView(buffer);
  const present = view.getUint8(0);
  const oldLength = view.getUint32(1, true);
  const old = new Uint8Array(buffer, 5, oldLength);
  const rest = new Uint8Array(buffer, 5 + oldLength);
  return { target, old: present & 1 ? old : null, new: present & 2 ? rest : null };
}

/** The line a hunk's bar goes after, in the old version or the new. */
function lineBefore(hunk: Hunk, old: boolean): number {
  const [, oldStart, oldCount, newStart, newCount] =
    /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))?/.exec(hunk.header)?.map(Number) ?? [];
  const [start, count] = old ? [oldStart, oldCount] : [newStart, newCount];
  // a hunk with no line on that side starts after the line it names
  return count === 0 ? start : Math.max(0, (start ?? 1) - 1);
}

/** A bar's place on the side without it, so that both sides stay level. */
function gap(): HTMLElement {
  const gap = document.createElement('div');
  gap.className = 'r-zone-gap';
  return gap;
}

/**
 * The changed lines between `first` and `last`: on the old side, the lines removed there;
 * on the new, the lines added there and those removed just before one of them.
 */
function pickedIn(diff: FileDiff | null, first: number, last: number, old: boolean): Picked[] {
  const picked: Picked[] = [];
  const within = (n: number | null) => n !== null && n >= first && n <= last;
  for (const hunk of diff?.hunks ?? []) {
    let removed: Picked[] = [];
    let next = 1;
    for (const line of hunk.lines) {
      if (line.kind === 'removed') {
        if (old && within(line.old)) picked.push({ old: line.old, new: null });
        else if (!old) removed.push({ old: line.old, new: null });
        continue;
      }
      if (within(line.new)) picked.push(...removed);
      removed = [];
      if (line.kind === 'added' && !old && within(line.new))
        picked.push({ old: null, new: line.new });
      next = (line.new ?? next) + 1;
    }
    if (within(next)) picked.push(...removed);
  }
  return picked;
}

/** Where each change starts in the new file: the file view goes from one to the next. */
function changeStarts(diff: FileDiff | null): number[] {
  const starts: number[] = [];
  for (const hunk of diff?.hunks ?? []) {
    let inside = false;
    let next = 1;
    for (const line of hunk.lines) {
      const changed = line.kind !== 'context';
      if (changed && !inside) starts.push(line.new ?? next);
      if (line.new !== null) next = line.new + 1;
      inside = changed;
    }
  }
  return [...new Set(starts)].sort((a, b) => a - b);
}

/**
 * The file view's marks: added lines tinted, a red notch where lines were removed, a deleted
 * file's lines all tinted red; beside the scrollbar too.
 */
function marks(
  monaco: MonacoApi,
  diff: FileDiff | null,
  deleted: boolean,
): Monaco.editor.IModelDeltaDecoration[] {
  const decorations: Monaco.editor.IModelDeltaDecoration[] = [];
  // marked along the scrollbar too: where the changes are, at a glance
  const full = monaco.editor.OverviewRulerLane.Full;
  for (const hunk of diff?.hunks ?? []) {
    let next = 1;
    for (const line of hunk.lines) {
      if (line.kind === 'added' && line.new !== null) {
        decorations.push({
          range: new monaco.Range(line.new, 1, line.new, 1),
          options: {
            isWholeLine: true,
            className: 'r-line-added',
            linesDecorationsClassName: 'r-gutter-added',
            overviewRuler: { color: { id: 'editorOverviewRuler.addedForeground' }, position: full },
          },
        });
      } else if (line.kind === 'removed' && deleted && line.old !== null) {
        // a deleted file shows its old lines, all of them removed
        decorations.push({
          range: new monaco.Range(line.old, 1, line.old, 1),
          options: {
            isWholeLine: true,
            className: 'r-line-removed',
            linesDecorationsClassName: 'r-gutter-removed-line',
            overviewRuler: {
              color: { id: 'editorOverviewRuler.deletedForeground' },
              position: full,
            },
          },
        });
      } else if (line.kind === 'removed') {
        decorations.push({
          range: new monaco.Range(next, 1, next, 1),
          options: {
            linesDecorationsClassName: 'r-gutter-removed',
            overviewRuler: {
              color: { id: 'editorOverviewRuler.deletedForeground' },
              position: full,
            },
          },
        });
      }
      if (line.new !== null) next = line.new + 1;
    }
  }
  return decorations;
}
