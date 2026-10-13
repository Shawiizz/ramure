import { Component, computed, inject, signal } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { LANGUAGES, language, locale, setLanguage, t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import {
  AUTO_FETCH_MINUTES,
  HISTORY_LIMITS,
  Preferences,
  THEMES,
  Theme,
} from '../../core/models/settings';
import { PreferencesService } from '../../core/services/preferences.service';

type Page = 'general' | 'git' | 'about';

/** The settings: a page per subject, every change applied and kept at once. */
@Component({
  selector: 'app-settings-dialog',
  templateUrl: './settings-dialog.html',
  styleUrl: './settings-dialog.scss',
  imports: [TPipe],
})
export class SettingsDialog {
  protected readonly service = inject(PreferencesService);
  protected readonly prefs = this.service.preferences;
  protected readonly page = signal<Page>('general');
  protected readonly pages = computed<{ id: Page; label: string }[]>(() => [
    { id: 'general', label: t('General') },
    { id: 'git', label: 'Git' },
    { id: 'about', label: t('About') },
  ]);
  protected readonly title = computed(() => this.pages().find((p) => p.id === this.page())!.label);
  protected readonly language = language;
  protected readonly languages = LANGUAGES;
  protected readonly setLanguage = setLanguage;
  protected readonly themes = THEMES;
  protected readonly themeNames = computed<Record<Theme, string>>(() => ({
    dark: t('Dark'),
    light: t('Light'),
    system: t('As the system'),
  }));
  protected readonly autoFetch = AUTO_FETCH_MINUTES;
  protected readonly historyLimits = HISTORY_LIMITS;
  protected readonly version = signal('');
  /** git's version once it answers, null when it cannot be found. */
  protected readonly gitVersion = signal<string | null>('');

  constructor() {
    getVersion().then((v) => this.version.set(v));
    invoke<string>('git_version').then(
      (v) => this.gitVersion.set(v),
      () => this.gitVersion.set(null),
    );
  }

  protected set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    this.service.set(key, value);
  }

  protected count(n: number): string {
    return n.toLocaleString(locale());
  }

  protected minutes(n: number): string {
    return n ? t('Every {n} min', { n }) : t('Never');
  }

  protected close() {
    this.service.open.set(false);
  }
}
