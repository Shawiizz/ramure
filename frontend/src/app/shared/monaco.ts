import { Signal, effect, inject, signal } from '@angular/core';
import loader from '@monaco-editor/loader';
import type * as Monaco from 'monaco-editor';
import { Preferences } from '../core/models/settings';
import { PreferencesService } from '../core/services/preferences.service';

export type MonacoApi = typeof Monaco;

const BASE = 'monaco/vs';
let loading: Promise<MonacoApi> | null = null;

/** Monaco, VS Code's editor, loaded from the app's own files the first time it is needed. */
export function loadMonaco(): Promise<MonacoApi> {
  loading ??= (async () => {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = `${BASE}/editor/editor.main.css`;
    document.head.append(style);
    loader.config({ paths: { vs: BASE } });
    return (await loader.init()) as MonacoApi;
  })();
  return loading;
}

/**
 * Monaco for a component, once loaded, in the app's colours while it lives; or why it
 * could not load. Called where `inject` works.
 */
export function injectMonaco(): {
  monaco: Signal<MonacoApi | null>;
  failure: Signal<string | null>;
} {
  const preferences = inject(PreferencesService);
  const monaco = signal<MonacoApi | null>(null);
  const failure = signal<string | null>(null);
  loadMonaco().then(
    (m) => monaco.set(m),
    (e) => failure.set(String(e)),
  );
  effect(() => {
    const m = monaco();
    const light = preferences.look().theme === 'light';
    // once the page wears the theme's colours, which Monaco's theme copies
    if (m) requestAnimationFrame(() => applyTheme(m, light));
  });
  return { monaco: monaco.asReadonly(), failure: failure.asReadonly() };
}

/** What every editor of Ramure shares: read-only, code drawn as the settings say. */
export function editorOptions(prefs: Preferences): Monaco.editor.IEditorOptions {
  return {
    readOnly: true,
    automaticLayout: true,
    contextmenu: false,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    stickyScroll: { enabled: false },
    unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
    lineNumbersMinChars: 4,
    renderLineHighlight: 'none',
    padding: { top: 8, bottom: 8 },
    ...codeLook(prefs),
  };
}

/** The code's look the settings choose: its font and size, the line numbers. */
export function codeLook(prefs: Preferences): Monaco.editor.IEditorOptions {
  const mono = token('mono');
  return {
    fontFamily: prefs.editorFont ? `'${prefs.editorFont}', ${mono}` : mono,
    fontSize: prefs.editorFontSize,
    lineHeight: Math.round(prefs.editorFontSize * 1.68),
    lineNumbers: prefs.lineNumbers ? 'on' : 'off',
  };
}

/** A model of `text`, coloured as the language of `path` is when the settings say so. */
export function codeModel(
  monaco: MonacoApi,
  text: string,
  path: string,
  prefs: Preferences,
): Monaco.editor.ITextModel {
  const model = monaco.editor.createModel(text);
  restyle(monaco, [model], path, prefs);
  return model;
}

/** Models brought in line with the settings: their language, their tabs' width. */
export function restyle(
  monaco: MonacoApi,
  models: Monaco.editor.ITextModel[],
  path: string,
  prefs: Preferences,
) {
  const language = prefs.syntax ? languageOf(monaco, path) : 'plaintext';
  for (const model of models) {
    monaco.editor.setModelLanguage(model, language);
    model.updateOptions({ tabSize: prefs.tabSize });
  }
}

/** A colour of the theme, read from its CSS token. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--r-${name}`).trim();
}

/** `#rrggbb` with an opacity, as Monaco wants it. */
function alpha(hex: string, opacity: number): string {
  return (
    hex +
    Math.round(opacity * 255)
      .toString(16)
      .padStart(2, '0')
  );
}

/** An `r g b` token as `#rrggbb`. */
function fromTriplet(name: string): string {
  return (
    '#' +
    token(name)
      .split(/\s+/)
      .map((c) => Number(c).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Ramure's colours, as a Monaco theme: made again whenever the app's theme changes. */
export function applyTheme(monaco: MonacoApi, light: boolean) {
  const added = fromTriplet('added-rgb');
  const removed = fromTriplet('removed-rgb');
  monaco.editor.defineTheme('ramure', {
    base: light ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': token('void'),
      'editor.foreground': token('text'),
      'editorLineNumber.foreground': token('text-3'),
      'editorLineNumber.activeForeground': token('text'),
      'editorGutter.background': token('void'),
      'editor.lineHighlightBackground': alpha(token('hover'), 0.6),
      'editor.selectionBackground': alpha(token('accent'), 0.3),
      'editorWidget.background': token('raised'),
      'editorWidget.border': token('line-strong'),
      // a line wholly added or removed gets both tints: the code reads through them
      'diffEditor.insertedLineBackground': alpha(added, 0.26),
      'diffEditor.removedLineBackground': alpha(removed, 0.13),
      'diffEditor.insertedTextBackground': alpha(added, 0.2),
      'diffEditor.removedTextBackground': alpha(removed, 0.14),
      'diffEditorGutter.insertedLineBackground': alpha(added, 0.4),
      'diffEditorGutter.removedLineBackground': alpha(removed, 0.24),
      'diffEditor.unchangedRegionBackground': token('raised'),
      'diffEditor.unchangedRegionForeground': token('text-3'),
      'diffEditor.border': token('line'),
      'scrollbarSlider.background': alpha(token('line-strong'), 0.7),
      'scrollbarSlider.hoverBackground': token('line-strong'),
    },
  });
  monaco.editor.setTheme('ramure');
}

/** Monaco's language for a file, from its name; plain text when none fits. */
export function languageOf(monaco: MonacoApi, path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const found = monaco.languages
    .getLanguages()
    .find(
      (l) =>
        l.filenames?.some((f) => f.toLowerCase() === name) ||
        l.extensions?.some((e) => name.endsWith(e.toLowerCase())),
    );
  return found?.id ?? 'plaintext';
}
