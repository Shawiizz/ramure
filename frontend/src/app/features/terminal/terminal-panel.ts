import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Channel, invoke } from '@tauri-apps/api/core';
import { FitAddon } from '@xterm/addon-fit';
import { ITheme, Terminal } from '@xterm/xterm';
import { TPipe } from '../../core/i18n/t.pipe';
import { PreferencesService } from '../../core/services/preferences.service';
import { RepositoryService } from '../../core/services/repository.service';

/**
 * A shell in the repository's folder, under the history: what it prints comes as it
 * comes, keys go to it rather than to Ramure. Ctrl+C copies a selection (interrupts
 * without one), Ctrl+V pastes.
 */
@Component({
  selector: 'app-terminal-panel',
  template: `
    <header class="head">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4l4 4-4 4M8.5 12.5H13" /></svg>
      <span class="title">{{ 'Terminal' | t }}</span>
      <span class="where r-mono">{{ repository.snapshot()?.path }}</span>
      <span class="space"></span>
      <button
        class="r-bar-btn icon"
        (click)="repository.terminalShown.set(false)"
        [attr.aria-label]="'Hide the terminal, its shell kept' | t"
        [title]="'Hide the terminal, its shell kept' | t"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
      </button>
      <button
        class="r-bar-btn icon"
        (click)="repository.closeTerminal()"
        [attr.aria-label]="'End the terminal' | t"
        [title]="'End the terminal' | t"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg>
      </button>
    </header>
    <div
      #screen
      class="screen"
      [class.dim]="!focused() && preferences.preferences().dimTerminal"
      (keydown)="$event.stopPropagation()"
    ></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      border-top: 1px solid var(--r-line);
      background: var(--r-void);
    }
    .head {
      flex: none;
      height: 30px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 4px 0 12px;
      border-bottom: 1px solid var(--r-line);
      background: var(--r-base);
      white-space: nowrap;
      > svg {
        width: 13px;
        height: 13px;
        fill: none;
        stroke: var(--r-text-3);
        stroke-width: 1.5;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
    }
    .title {
      color: var(--r-text-2);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .where {
      min-width: 0;
      overflow: hidden;
      color: var(--r-text-3);
      font-size: 11.5px;
      text-overflow: ellipsis;
    }
    .space {
      flex: 1;
    }
    .icon {
      width: 26px;
      height: 24px;
      padding: 0;
      justify-content: center;
      svg {
        width: 10px;
        height: 10px;
      }
    }
    .screen {
      flex: 1;
      min-height: 0;
      padding: 6px 0 0 12px;
      transition: opacity var(--r-fast);
      &.dim {
        opacity: 0.6;
      }
    }
  `,
  imports: [TPipe],
})
export class TerminalPanel {
  protected readonly repository = inject(RepositoryService);
  protected readonly preferences = inject(PreferencesService);
  private readonly screen = viewChild.required<ElementRef<HTMLElement>>('screen');
  private readonly terminal = new Terminal({ cursorBlink: true, scrollback: 5000 });
  /** The terminal has the keys: undimmed. */
  protected readonly focused = signal(false);
  private readonly fit = new FitAddon();
  /** The shell's id once it runs. */
  private id: number | null = null;

  constructor() {
    const destroy = inject(DestroyRef);
    this.terminal.loadAddon(this.fit);
    this.terminal.attachCustomKeyEventHandler((event) => this.key(event));
    effect(() => {
      const prefs = this.preferences.preferences();
      const options = this.terminal.options;
      const mono = token('mono');
      const font = prefs.terminalFont || prefs.editorFont;
      options.fontFamily = font ? `'${font}', ${mono}` : mono;
      options.fontSize = prefs.terminalFontSize;
      options.lineHeight = prefs.terminalLineHeight;
      options.cursorStyle = prefs.cursorStyle;
      // drawn, it takes as many lines and columns as its new size allows
      if (this.terminal.element?.offsetHeight) this.fit.fit();
    });
    effect(() => {
      // the colours follow the theme and the accent
      this.preferences.look();
      // once the page wears the new colours, which the terminal copies
      requestAnimationFrame(() => (this.terminal.options.theme = theme()));
    });
    afterNextRender(() => {
      const element = this.screen().nativeElement;
      this.terminal.open(element);
      this.terminal.textarea?.addEventListener('focus', () => this.focused.set(true));
      this.terminal.textarea?.addEventListener('blur', () => this.focused.set(false));
      const resized = new ResizeObserver(() => {
        // hidden, it has no size to fit
        if (element.offsetHeight) this.fit.fit();
      });
      resized.observe(element);
      this.terminal.onResize(({ cols, rows }) => this.send('terminal_resize', { cols, rows }));
      this.terminal.onData((data) => this.send('terminal_write', { data }));
      void this.start();
      destroy.onDestroy(() => {
        resized.disconnect();
        if (this.id !== null) void invoke('terminal_close', { id: this.id });
        this.terminal.dispose();
      });
    });
  }

  private async start() {
    const path = this.repository.snapshot()?.path;
    if (!path) return;
    this.fit.fit();
    const output = new Channel<ArrayBuffer>();
    output.onmessage = (chunk) => {
      const bytes = new Uint8Array(chunk);
      // an empty chunk: the shell has ended
      if (bytes.length) this.terminal.write(bytes);
      else this.repository.closeTerminal();
    };
    const { cols, rows } = this.terminal;
    try {
      const shell = this.preferences.preferences().terminalShell;
      this.id = await invoke<number>('terminal_open', { path, shell, cols, rows, output });
      this.terminal.focus();
    } catch (e) {
      this.terminal.write(`\x1b[31m${String(e)}\x1b[0m\r\n`);
    }
  }

  private send(command: 'terminal_write' | 'terminal_resize', args: Record<string, unknown>) {
    if (this.id !== null) void invoke(command, { id: this.id, ...args });
  }

  /** The keys the terminal leaves to Ramure, or answers itself: false when handled. */
  private key(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown' || !event.ctrlKey || event.altKey) return true;
    if (event.code === 'Backquote') {
      this.repository.toggleTerminal();
      return false;
    }
    const key = event.key.toLowerCase();
    if (key === 'c' && this.terminal.hasSelection()) {
      void navigator.clipboard.writeText(this.terminal.getSelection());
      this.terminal.clearSelection();
      return false;
    }
    if (key === 'v') {
      event.preventDefault();
      void navigator.clipboard.readText().then((text) => this.terminal.paste(text));
      return false;
    }
    return true;
  }
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--r-${name}`).trim();
}

/** The terminal's colours, from the page's own. */
function theme(): ITheme {
  return {
    background: token('void'),
    foreground: token('text'),
    cursor: token('accent'),
    cursorAccent: token('void'),
    // the accent at about a third, as #rrggbbaa
    selectionBackground: `${token('accent')}59`,
  };
}
