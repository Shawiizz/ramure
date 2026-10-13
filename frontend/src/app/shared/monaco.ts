import loader from '@monaco-editor/loader';
import type * as Monaco from 'monaco-editor';

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
