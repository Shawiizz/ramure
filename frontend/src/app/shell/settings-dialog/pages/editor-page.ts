import { Component } from '@angular/core';
import { TPipe } from '../../../core/i18n/t.pipe';
import { FONT_SIZES, TAB_SIZES } from '../../../core/models/settings';
import { SettingsPage } from '../settings-page';

/** Monospace fonts often installed, offered as the font is typed. */
export const MONO_FONTS: readonly string[] = [
  'Cascadia Code',
  'Cascadia Mono',
  'Consolas',
  'JetBrains Mono',
  'Fira Code',
  'Source Code Pro',
  'Hack',
  'Courier New',
];

/** How code reads in the diffs, the blame and the editor. */
@Component({
  selector: 'app-editor-page',
  template: `
    <div class="row">
      <div>
        <span class="name">{{ 'Font' | t }}</span>
        <span class="help">{{
          'Any installed font, by its name; Ramure’s own when empty.' | t
        }}</span>
      </div>
      <input
        class="field"
        list="mono-fonts"
        [value]="prefs().editorFont"
        (change)="set('editorFont', $any($event.target).value.trim())"
        placeholder="Geist Mono"
        spellcheck="false"
      />
      <datalist id="mono-fonts">
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
        (change)="set('editorFontSize', +$any($event.target).value)"
        [attr.aria-label]="'Font size' | t"
      >
        @for (size of sizes; track size) {
          <option [value]="size" [selected]="size === prefs().editorFontSize">{{ size }} px</option>
        }
      </select>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Tab size' | t }}</span>
        <span class="help">{{ 'How many spaces a tab character takes.' | t }}</span>
      </div>
      <div class="seg" role="radiogroup" [attr.aria-label]="'Tab size' | t">
        @for (size of tabSizes; track size) {
          <button
            role="radio"
            [attr.aria-checked]="prefs().tabSize === size"
            (click)="set('tabSize', size)"
          >
            {{ size }}
          </button>
        }
      </div>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Line numbers' | t }}</span>
      </div>
      <button
        class="switch"
        role="switch"
        [attr.aria-checked]="prefs().lineNumbers"
        [attr.aria-label]="'Line numbers' | t"
        (click)="set('lineNumbers', !prefs().lineNumbers)"
      ></button>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Syntax highlighting' | t }}</span>
        <span class="help">{{ 'Code coloured as its language is.' | t }}</span>
      </div>
      <button
        class="switch"
        role="switch"
        [attr.aria-checked]="prefs().syntax"
        [attr.aria-label]="'Syntax highlighting' | t"
        (click)="set('syntax', !prefs().syntax)"
      ></button>
    </div>
  `,
  styleUrl: '../rows.scss',
  imports: [TPipe],
})
export class EditorPage extends SettingsPage {
  protected readonly fonts = MONO_FONTS;
  protected readonly sizes = FONT_SIZES;
  protected readonly tabSizes = TAB_SIZES;
}
