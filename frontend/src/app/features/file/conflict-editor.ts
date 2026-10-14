import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import type * as Monaco from 'monaco-editor';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Sides, Version } from '../../core/models/repository';
import { Choice, Conflict, findConflicts, resolution } from '../../shared/conflicts';
import { MonacoApi, zoneBar } from '../../shared/monaco';
import { MenusService } from '../repository-tab/menus.service';
import { FileEditor } from './file-editor';

/** How long typing goes on before the conflicts are looked for again. */
const READ_AGAIN_MS = 150;

/**
 * A file in conflict, edited: each conflict's sides tinted, a bar above it to keep one side
 * or both; marked resolved once saved and staged. A file one side deleted, or that cannot be
 * edited here, takes one side's version whole.
 */
@Component({
  selector: 'app-conflict-editor',
  template: `
    <div class="tools">
      @if (deleter(); as deleter) {
        <span class="count">
          {{
            deleter === 'incoming'
              ? ('The incoming version deletes this file.' | t)
              : ('The current version deletes this file.' | t)
          }}
        </span>
        <span class="space"></span>
        <button
          class="r-bar-btn"
          [disabled]="!opened() || repository.working()"
          (click)="resolve()"
        >
          {{ 'Keep the file' | t }}
        </button>
        <button class="r-bar-btn danger" [disabled]="repository.working()" (click)="take(deleter)">
          {{ 'Delete the file' | t }}
        </button>
      } @else {
        <span class="count">
          @switch (conflicts().length) {
            @case (0) {
              {{ 'No conflict left' | t }}
            }
            @case (1) {
              {{ '1 conflict' | t }}
            }
            @default {
              {{ '{n} conflicts' | t: { n: conflicts().length } }}
            }
          }
        </span>
        <div class="group">
          <button
            class="r-bar-btn icon"
            [disabled]="!conflicts().length"
            (click)="go(false)"
            [attr.aria-label]="'Previous conflict' | t"
            [title]="'Previous conflict' | t"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4" /></svg>
          </button>
          <button
            class="r-bar-btn icon"
            [disabled]="!conflicts().length"
            (click)="go(true)"
            [attr.aria-label]="'Next conflict' | t"
            [title]="'Next conflict' | t"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M4 9l4 4 4-4" /></svg>
          </button>
        </div>
        <span class="space"></span>
        @if (failure()) {
          <button class="r-bar-btn" [disabled]="repository.working()" (click)="take('current')">
            {{ 'Keep the current version' | t }}
          </button>
          <button class="r-bar-btn" [disabled]="repository.working()" (click)="take('incoming')">
            {{ 'Keep the incoming version' | t }}
          </button>
        } @else {
          <button class="r-bar-btn" [disabled]="!conflicts().length" (click)="keepAll('current')">
            {{ 'Keep all current' | t }}
          </button>
          <button class="r-bar-btn" [disabled]="!conflicts().length" (click)="keepAll('incoming')">
            {{ 'Keep all incoming' | t }}
          </button>
          <button
            class="r-btn r-btn--primary small"
            [disabled]="!opened() || repository.working()"
            (click)="resolve()"
          >
            {{ 'Mark resolved' | t }}
          </button>
        }
      }
    </div>
    <div class="body">
      <div class="editor" #host></div>
      @if (failure(); as failure) {
        <p class="note error">{{ failure }}</p>
      } @else if (!opened()) {
        <p class="note">{{ 'Reading…' | t }}</p>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
    }
    .tools {
      flex: none;
      height: 40px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 10px 0 16px;
      border-bottom: 1px solid var(--r-line);
      background: var(--r-base);
    }
    .count {
      color: var(--r-text-2);
      font-size: 12px;
    }
    .group {
      display: flex;
      gap: 2px;
    }
    .space {
      flex: 1;
    }
    .r-bar-btn.danger:hover {
      color: rgb(var(--r-removed-rgb));
    }
    .icon {
      width: 30px;
      padding: 0;
      justify-content: center;
      svg {
        width: 15px;
        height: 15px;
        stroke-linejoin: round;
      }
    }
    .small {
      height: 26px;
      padding: 0 10px;
      font-size: 12px;
    }
    .body {
      position: relative;
      flex: 1;
      min-height: 0;
    }
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
  providers: [{ provide: FileEditor, useExisting: ConflictEditor }],
})
export class ConflictEditor extends FileEditor {
  private readonly menus = inject(MenusService);
  protected readonly conflicts = signal<Conflict[]>([]);
  private readonly sides = signal<Sides | null>(null);
  /** The side that deleted the file the other one changed, if one did. */
  protected readonly deleter = computed<Version | null>(() => {
    const sides = this.sides();
    if (!sides || sides.current === sides.incoming) return null;
    return sides.current ? 'incoming' : 'current';
  });
  private marks: Monaco.editor.IEditorDecorationsCollection | null = null;
  private bars: string[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    effect(() => {
      const file = this.path();
      untracked(() => void this.readSides(file));
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected override opening(
    monaco: MonacoApi,
    editor: Monaco.editor.IStandaloneCodeEditor,
    model: Monaco.editor.ITextModel,
  ) {
    this.marks = editor.createDecorationsCollection();
    this.bars = [];
    model.onDidChangeContent(() => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.mark(monaco, editor, model), READ_AGAIN_MS);
    });
    this.mark(monaco, editor, model);
    const first = this.conflicts()[0];
    if (first) editor.revealLineNearTop(first.start);
  }

  /** Moves to the next conflict, or the previous one, going round. */
  protected go(next: boolean) {
    const editor = this.editor;
    const starts = this.conflicts().map((c) => c.start);
    if (!editor || !starts.length) return;
    const at = editor.getPosition()?.lineNumber ?? 0;
    const line = next
      ? (starts.find((l) => l > at) ?? starts[0])
      : ([...starts].reverse().find((l) => l < at) ?? starts[starts.length - 1]);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.revealLineNearTop(line);
    editor.focus();
  }

  protected keepAll(choice: Choice) {
    const model = this.editor?.getModel();
    if (model) this.choose(findConflicts(model.getLinesContent()), choice);
  }

  /** The file as one side has it, whole: when it cannot be edited here. */
  protected async take(version: Version) {
    if (await this.repository.takeVersion(this.path(), version))
      this.repository.filePanel.set(null);
  }

  /** Saves and stages the file; once sure, when conflicts are left in it. */
  protected resolve() {
    const path = this.path();
    const done = async () => {
      await this.save();
      if (!this.dirty() && (await this.repository.stage([path]))) {
        this.repository.filePanel.set(null);
      }
    };
    if (!this.conflicts().length) {
      void done();
      return;
    }
    this.menus.ask({
      title: t('Mark resolved with conflicts left?'),
      text: t('Their markers are staged, then committed, as they are.'),
      fields: [],
      confirm: t('Mark resolved'),
      answered: () => void done(),
    });
  }

  private async readSides(file: string) {
    const path = this.repository.snapshot()?.path;
    this.sides.set(null);
    if (!path) return;
    try {
      const sides = await invoke<Sides>('conflict_sides', { path, file });
      if (this.path() === file) this.sides.set(sides);
    } catch (e) {
      this.repository.error.set(String(e));
    }
  }

  /** Finds the conflicts again: their tints, and the bars above them. */
  private mark(
    monaco: MonacoApi,
    editor: Monaco.editor.IStandaloneCodeEditor,
    model: Monaco.editor.ITextModel,
  ) {
    if (model.isDisposed()) return;
    const conflicts = findConflicts(model.getLinesContent());
    this.conflicts.set(conflicts);
    this.marks?.set(conflicts.flatMap((c) => tints(monaco, c)));
    editor.changeViewZones((zones) => {
      this.bars.forEach((id) => zones.removeZone(id));
      this.bars = conflicts.map((conflict, i) =>
        zones.addZone({
          afterLineNumber: conflict.start - 1,
          heightInPx: 28,
          domNode: zoneBar(
            t('Current: {current} · Incoming: {incoming}', {
              current: conflict.current,
              incoming: conflict.incoming,
            }),
            [
              { label: t('Keep current'), run: () => this.keepOne(i, 'current') },
              { label: t('Keep incoming'), run: () => this.keepOne(i, 'incoming') },
              { label: t('Keep both'), run: () => this.keepOne(i, 'both') },
            ],
          ),
        }),
      );
    });
  }

  /** Resolves the conflict `index`, as the file has it now. */
  private keepOne(index: number, choice: Choice) {
    const model = this.editor?.getModel();
    const conflict = model && findConflicts(model.getLinesContent())[index];
    if (conflict) this.choose([conflict], choice);
  }

  /** Puts each conflict's resolution in its place, in one edit that Ctrl+Z takes back. */
  private choose(conflicts: Conflict[], choice: Choice) {
    const editor = this.editor;
    const model = editor?.getModel();
    const monaco = this.loaded.monaco();
    if (!editor || !model || !monaco || !conflicts.length) return;
    const lines = model.getLinesContent();
    const eol = model.getEOL();
    const last = model.getLineCount();
    const edits = conflicts.map((c) => {
      const kept = resolution(lines, c, choice);
      // the conflict's lines with the line break after them; at the end, the one before
      const range =
        c.end < last
          ? new monaco.Range(c.start, 1, c.end + 1, 1)
          : new monaco.Range(c.start, 1, c.end, model.getLineMaxColumn(c.end));
      const text = kept.map((l) => (c.end < last ? l + eol : l)).join(c.end < last ? '' : eol);
      return { range, text };
    });
    editor.pushUndoStop();
    editor.executeEdits('conflicts', edits);
    editor.pushUndoStop();
    this.mark(monaco, editor, model);
  }
}

/** A conflict's lines tinted: its markers, the current side, the common one, the incoming one. */
function tints(monaco: MonacoApi, c: Conflict): Monaco.editor.IModelDeltaDecoration[] {
  const lines = (from: number, to: number, className: string) =>
    from <= to
      ? [{ range: new monaco.Range(from, 1, to, 1), options: { isWholeLine: true, className } }]
      : [];
  const split = c.base ?? c.middle;
  return [
    ...lines(c.start, c.start, 'r-conflict-current-marker'),
    ...lines(c.start + 1, split - 1, 'r-conflict-current'),
    ...(c.base
      ? [
          ...lines(c.base, c.base, 'r-conflict-marker'),
          ...lines(c.base + 1, c.middle - 1, 'r-conflict-base'),
        ]
      : []),
    ...lines(c.middle, c.middle, 'r-conflict-marker'),
    ...lines(c.middle + 1, c.end - 1, 'r-conflict-incoming'),
    ...lines(c.end, c.end, 'r-conflict-incoming-marker'),
  ];
}
