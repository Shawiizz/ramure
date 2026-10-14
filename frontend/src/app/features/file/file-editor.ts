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
import { RepositoryService } from '../../core/services/repository.service';
import { decode, guessEncoding } from '../../shared/encoding';
import {
  MonacoApi,
  codeLook,
  codeModel,
  editorOptions,
  injectMonaco,
  restyle,
} from '../../shared/monaco';
import { PreferencesService } from '../../core/services/preferences.service';

/** A file of the working tree read for editing: its text, and whether it began with a BOM. */
interface Opened {
  file: string;
  text: string;
  bom: boolean;
}

/** A file of the working tree in VS Code's editor, saved with Ctrl+S; UTF-8 text only. */
@Component({
  selector: 'app-file-editor',
  template: `
    <div class="editor" #host></div>
    @if (failure(); as failure) {
      <p class="note error">{{ failure }}</p>
    } @else if (!opened()) {
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
export class FileEditor {
  protected readonly repository = inject(RepositoryService);
  protected readonly prefs = inject(PreferencesService).preferences;
  readonly path = input.required<string>();
  protected readonly loaded = injectMonaco();
  private readonly readFailure = signal<string | null>(null);
  protected readonly failure = computed(() => this.loaded.failure() ?? this.readFailure());
  protected readonly opened = signal<Opened | null>(null);
  /** Edits made since the file was read or saved. */
  readonly dirty = signal(false);
  private readonly host = viewChild<ElementRef<HTMLElement>>('host');
  protected editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  /** The model's version as last saved. */
  private saved = 0;

  constructor() {
    effect(() => {
      const file = this.path();
      untracked(() => this.read(file));
    });
    effect(() => {
      const monaco = this.loaded.monaco();
      const host = this.host()?.nativeElement;
      const opened = this.opened();
      if (monaco && host && opened) untracked(() => this.show(monaco, host, opened));
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

  /** Writes the text back, with its BOM if it had one. */
  async save(): Promise<void> {
    const opened = this.opened();
    const model = this.editor?.getModel();
    if (!opened || !model || !this.dirty()) return;
    const version = model.getAlternativeVersionId();
    const text = (opened.bom ? '﻿' : '') + model.getValue();
    if (await this.repository.writeFile(opened.file, text)) {
      this.saved = version;
      this.dirty.set(model.getAlternativeVersionId() !== version);
    }
  }

  private async read(file: string) {
    const path = this.repository.snapshot()?.path;
    this.opened.set(null);
    this.readFailure.set(null);
    if (!path) return;
    try {
      const bytes = new Uint8Array(await invoke<ArrayBuffer>('read_file', { path, file }));
      if (this.path() !== file) return;
      const encoding = guessEncoding(bytes);
      if (encoding !== 'utf-8' && encoding !== 'utf-8-bom') {
        this.readFailure.set(t('Only UTF-8 text files can be edited here.'));
        return;
      }
      const bom = encoding === 'utf-8-bom';
      this.opened.set({ file, text: decode(bytes, encoding), bom });
    } catch (e) {
      this.readFailure.set(String(e));
    }
  }

  private show(monaco: MonacoApi, host: HTMLElement, opened: Opened) {
    if (!this.editor) {
      this.editor = monaco.editor.create(host, {
        ...editorOptions(this.prefs()),
        readOnly: false,
        renderLineHighlight: 'line',
      });
      this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void this.save());
    }
    const old = this.editor.getModel();
    // the file's own line endings are kept: the model takes them from its text
    const model = codeModel(monaco, opened.text, opened.file, this.prefs());
    this.editor.setModel(model);
    old?.dispose();
    this.saved = model.getAlternativeVersionId();
    this.dirty.set(false);
    model.onDidChangeContent(() => this.dirty.set(model.getAlternativeVersionId() !== this.saved));
    this.opening(monaco, this.editor, model);
    this.editor.focus();
  }

  /** What an editor made for a purpose adds once the file is shown. */
  protected opening(
    monaco: MonacoApi,
    editor: Monaco.editor.IStandaloneCodeEditor,
    model: Monaco.editor.ITextModel,
  ): void {}
}
