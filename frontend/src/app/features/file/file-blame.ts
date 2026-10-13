import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import type * as Monaco from 'monaco-editor';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Blame } from '../../core/models/repository';
import { RepositoryService } from '../../core/services/repository.service';
import {
  MonacoApi,
  codeLook,
  codeModel,
  editorOptions,
  injectMonaco,
  restyle,
} from '../../shared/monaco';
import { PreferencesService } from '../../core/services/preferences.service';
import { fullDate, when } from '../../shared/when';

/** The width of the blame beside each line, in characters: the author, then the date. */
const AUTHOR_WIDTH = 18;
const BLAME_WIDTH = 34;

/**
 * A file with, before each run of lines, who last changed them and when; a click there
 * shows that commit in the details.
 */
@Component({
  selector: 'app-file-blame',
  template: `
    <div class="editor" #host></div>
    @if (failure(); as failure) {
      <p class="note error">{{ failure }}</p>
    } @else if (!blame()) {
      <p class="note">{{ 'Reading…' | t }}</p>
    }
  `,
  styles: `
    .editor {
      position: absolute;
      inset: 0;
    }
    .note {
      position: absolute;
      inset: 32px 0 auto;
      margin: 0;
      color: var(--r-text-3);
      text-align: center;
      &.error {
        color: var(--r-danger);
        user-select: text;
      }
    }
  `,
  imports: [TPipe],
})
export class FileBlame {
  private readonly repository = inject(RepositoryService);
  private readonly prefs = inject(PreferencesService).preferences;
  readonly path = input.required<string>();
  readonly at = input<string | undefined>();
  private readonly loaded = injectMonaco();
  private readonly readFailure = signal<string | null>(null);
  protected readonly failure = computed(() => this.loaded.failure() ?? this.readFailure());
  protected readonly blame = signal<Blame | null>(null);
  private readonly host = viewChild<ElementRef<HTMLElement>>('host');
  private editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  private decorations: Monaco.editor.IEditorDecorationsCollection | null = null;

  constructor() {
    effect(() => {
      const file = this.path();
      const at = this.at();
      untracked(() => this.read(file, at));
    });
    effect(() => {
      const monaco = this.loaded.monaco();
      const host = this.host()?.nativeElement;
      const blame = this.blame();
      if (monaco && host && blame) untracked(() => this.show(monaco, host, blame));
    });
    effect(() => {
      const prefs = this.prefs();
      untracked(() => {
        const model = this.editor?.getModel();
        this.editor?.updateOptions(codeLook(prefs));
        if (model && this.loaded.monaco())
          restyle(this.loaded.monaco()!, [model], this.path(), prefs);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.editor?.getModel()?.dispose();
      this.editor?.dispose();
    });
  }

  private async read(file: string, at: string | undefined) {
    const path = this.repository.snapshot()?.path;
    this.blame.set(null);
    this.readFailure.set(null);
    if (!path) return;
    try {
      const blame = await invoke<Blame>('blame', { path, file, at: at ?? null });
      if (this.path() === file && this.at() === at) this.blame.set(blame);
    } catch (e) {
      this.readFailure.set(String(e));
    }
  }

  private show(monaco: MonacoApi, host: HTMLElement, blame: Blame) {
    if (!this.editor) {
      // the guides would cross the blame, which stands before the indentation
      this.editor = monaco.editor.create(host, {
        ...editorOptions(this.prefs()),
        guides: { indentation: false },
      });
      // a click on a line's blame shows its commit
      this.editor.onMouseDown((e) => {
        const onBlame = !!e.target.element?.closest('.r-blame-first');
        const line = e.target.position?.lineNumber;
        const id = onBlame && line ? this.blame()?.lines[line - 1] : undefined;
        if (id && !uncommitted(id)) this.repository.select(id);
      });
    }
    const old = this.editor.getModel();
    this.editor.setModel(codeModel(monaco, blame.text, this.path(), this.prefs()));
    old?.dispose();
    this.decorations?.clear();
    this.decorations = this.editor.createDecorationsCollection(marks(monaco, blame));
  }
}

function uncommitted(id: string): boolean {
  return /^0+$/.test(id);
}

/** Before the first line of each run from one commit, its author and date; the others blank. */
function marks(monaco: MonacoApi, blame: Blame): Monaco.editor.IModelDeltaDecoration[] {
  return blame.lines.map((id, i) => {
    const first = i === 0 || blame.lines[i - 1] !== id;
    const commit = blame.commits[id];
    const label = !first
      ? ''
      : uncommitted(id)
        ? t('Not committed yet')
        : `${fit(commit.author, AUTHOR_WIDTH)} ${when(commit.time)}`;
    return {
      range: new monaco.Range(i + 1, 1, i + 1, 1),
      options: {
        // an empty range: without this, Monaco leaves its text out
        showIfCollapsed: true,
        before: {
          content: fit(label, BLAME_WIDTH) + '  ',
          inlineClassName: first ? 'r-blame r-blame-first' : 'r-blame',
          cursorStops: monaco.editor.InjectedTextCursorStops.None,
        },
        hoverMessage:
          first && !uncommitted(id)
            ? {
                value: `**${escape(commit.summary)}**\n\n${escape(commit.author)} · ${fullDate(commit.time)} · \`${id.slice(0, 7)}\``,
              }
            : undefined,
      },
    };
  });
}

/** `text` cut or padded to `width` characters. */
function fit(text: string, width: number): string {
  return text.length > width ? text.slice(0, width - 1) + '…' : text.padEnd(width);
}

/** Markdown taken literally. */
function escape(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
