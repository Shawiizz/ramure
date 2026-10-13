import { Component, computed } from '@angular/core';
import { LANGUAGES, language, setLanguage, t } from '../../../core/i18n/i18n';
import { TPipe } from '../../../core/i18n/t.pipe';
import { ACCENTS, Accent, SCROLL_SPEEDS, THEMES, Theme } from '../../../core/models/settings';
import { SettingsPage } from '../settings-page';

/** The language, the look, and how the app opens and scrolls. */
@Component({
  selector: 'app-general-page',
  template: `
    <div class="row">
      <div>
        <span class="name">{{ 'Language' | t }}</span>
        <span class="help">{{ 'The texts, the dates and the numbers.' | t }}</span>
      </div>
      <div class="seg" role="radiogroup" [attr.aria-label]="'Language' | t">
        @for (l of languages; track l.id) {
          <button
            role="radio"
            [attr.aria-checked]="language() === l.id"
            (click)="setLanguage(l.id)"
          >
            {{ l.name }}
          </button>
        }
      </div>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Theme' | t }}</span>
        <span class="help">{{ 'Dark, light, or as the system is.' | t }}</span>
      </div>
      <div class="seg" role="radiogroup" [attr.aria-label]="'Theme' | t">
        @for (theme of themes; track theme) {
          <button
            role="radio"
            [attr.aria-checked]="prefs().theme === theme"
            (click)="set('theme', theme)"
          >
            {{ themeNames()[theme] }}
          </button>
        }
      </div>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Accent colour' | t }}</span>
        <span class="help">{{ 'The buttons, the selections and the graph’s main lane.' | t }}</span>
      </div>
      <div class="swatches" role="radiogroup" [attr.aria-label]="'Accent colour' | t">
        @for (accent of accents; track accent) {
          <button
            role="radio"
            [class]="'swatch ' + accent"
            [attr.aria-checked]="prefs().accent === accent"
            [attr.aria-label]="accentNames()[accent]"
            [title]="accentNames()[accent]"
            (click)="set('accent', accent)"
          ></button>
        }
      </div>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Reopen the tabs' | t }}</span>
        <span class="help">{{ 'At startup, the repositories open when Ramure closed.' | t }}</span>
      </div>
      <button
        class="switch"
        role="switch"
        [attr.aria-checked]="prefs().reopenTabs"
        [attr.aria-label]="'Reopen the tabs' | t"
        (click)="set('reopenTabs', !prefs().reopenTabs)"
      ></button>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Scrolling speed' | t }}</span>
        <span class="help">{{
          'How far a wheel’s notch scrolls the history and the diffs.' | t
        }}</span>
      </div>
      <div class="seg" role="radiogroup" [attr.aria-label]="'Scrolling speed' | t">
        @for (speed of scrollSpeeds; track speed) {
          <button
            role="radio"
            [attr.aria-checked]="prefs().scrollSpeed === speed"
            (click)="set('scrollSpeed', speed)"
          >
            {{ speedNames()[speed] }}
          </button>
        }
      </div>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Relative dates' | t }}</span>
        <span class="help">{{ '“3 days ago” in the history, rather than the date.' | t }}</span>
      </div>
      <button
        class="switch"
        role="switch"
        [attr.aria-checked]="prefs().relativeDates"
        [attr.aria-label]="'Relative dates' | t"
        (click)="set('relativeDates', !prefs().relativeDates)"
      ></button>
    </div>
  `,
  styleUrls: ['../rows.scss', './general-page.scss'],
  imports: [TPipe],
})
export class GeneralPage extends SettingsPage {
  protected readonly language = language;
  protected readonly languages = LANGUAGES;
  protected readonly setLanguage = setLanguage;
  protected readonly themes = THEMES;
  protected readonly accents = ACCENTS;
  protected readonly scrollSpeeds = SCROLL_SPEEDS;
  protected readonly themeNames = computed<Record<Theme, string>>(() => ({
    dark: t('Dark'),
    light: t('Light'),
    system: t('As the system'),
  }));
  protected readonly accentNames = computed<Record<Accent, string>>(() => ({
    blue: t('Blue'),
    violet: t('Violet'),
    green: t('Green'),
    orange: t('Orange'),
    neutral: t('Neutral'),
  }));
  protected readonly speedNames = computed<Record<number, string>>(() => ({
    1: t('As the system'),
    1.5: t('Fast'),
    2.5: t('Very fast'),
  }));
}
