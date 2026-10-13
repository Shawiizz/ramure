import { Component, computed, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../../core/i18n/i18n';
import { TPipe } from '../../../core/i18n/t.pipe';
import {
  CURSOR_STYLES,
  CursorStyle,
  FONT_SIZES,
  LINE_HEIGHTS,
  TerminalShell,
} from '../../../core/models/settings';
import { SettingsPage } from '../settings-page';
import { MONO_FONTS } from './editor-page';

/** The shell the terminal opens, and how it is drawn. */
@Component({
  selector: 'app-terminal-page',
  template: `
    <div class="row">
      <div>
        <span class="name">{{ 'Shell' | t }}</span>
        <span class="help">{{ 'The terminals opened from now on run it.' | t }}</span>
      </div>
      <select
        class="field"
        (change)="set('terminalShell', $any($event.target).value)"
        [attr.aria-label]="'Shell' | t"
      >
        @for (shell of shells(); track shell) {
          <option [value]="shell" [selected]="shell === prefs().terminalShell">
            {{ shellNames()[shell] }}
          </option>
        }
      </select>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Font' | t }}</span>
        <span class="help">{{ 'The editor’s when empty.' | t }}</span>
      </div>
      <input
        class="field"
        list="terminal-fonts"
        [value]="prefs().terminalFont"
        (change)="set('terminalFont', $any($event.target).value.trim())"
        [placeholder]="prefs().editorFont || 'Geist Mono'"
        spellcheck="false"
      />
      <datalist id="terminal-fonts">
        @for (font of fonts; track font) {
          <option [value]="font"></option>
        }
      </datalist>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Font size' | t }}</span>
      </div>
      <select
        class="field small"
        (change)="set('terminalFontSize', +$any($event.target).value)"
        [attr.aria-label]="'Font size' | t"
      >
        @for (size of sizes; track size) {
          <option [value]="size" [selected]="size === prefs().terminalFontSize">
            {{ size }} px
          </option>
        }
      </select>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Line height' | t }}</span>
      </div>
      <div class="seg" role="radiogroup" [attr.aria-label]="'Line height' | t">
        @for (height of lineHeights; track height) {
          <button
            role="radio"
            [attr.aria-checked]="prefs().terminalLineHeight === height"
            (click)="set('terminalLineHeight', height)"
          >
            {{ height }}
          </button>
        }
      </div>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Cursor' | t }}</span>
      </div>
      <div class="seg" role="radiogroup" [attr.aria-label]="'Cursor' | t">
        @for (style of cursors; track style) {
          <button
            role="radio"
            [attr.aria-checked]="prefs().cursorStyle === style"
            (click)="set('cursorStyle', style)"
          >
            {{ cursorNames()[style] }}
          </button>
        }
      </div>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Dim when unfocused' | t }}</span>
        <span class="help">{{ 'The terminal fades while the keys go elsewhere.' | t }}</span>
      </div>
      <button
        class="switch"
        role="switch"
        [attr.aria-checked]="prefs().dimTerminal"
        [attr.aria-label]="'Dim when unfocused' | t"
        (click)="set('dimTerminal', !prefs().dimTerminal)"
      ></button>
    </div>
  `,
  styleUrl: '../rows.scss',
  imports: [TPipe],
})
export class TerminalPage extends SettingsPage {
  protected readonly fonts = MONO_FONTS;
  protected readonly sizes = FONT_SIZES;
  protected readonly lineHeights = LINE_HEIGHTS;
  protected readonly cursors = CURSOR_STYLES;
  /** The shells found on this computer; the system's choice first. */
  protected readonly shells = signal<TerminalShell[]>(['auto']);
  protected readonly shellNames = computed<Record<TerminalShell, string>>(() => ({
    auto: t('The system’s'),
    powershell: 'Windows PowerShell',
    pwsh: 'PowerShell 7',
    cmd: t('Command prompt'),
    gitBash: 'Git Bash',
    wsl: 'WSL',
  }));
  protected readonly cursorNames = computed<Record<CursorStyle, string>>(() => ({
    bar: t('Bar'),
    block: t('Block'),
    underline: t('Underline'),
  }));

  constructor() {
    super();
    invoke<TerminalShell[]>('terminal_shells').then(
      (found) => this.shells.set(['auto', ...found]),
      (e) => console.error('shells not listed', e),
    );
  }
}
