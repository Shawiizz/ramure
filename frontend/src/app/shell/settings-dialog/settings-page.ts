import { Directive, inject } from '@angular/core';
import { Preferences } from '../../core/models/settings';
import { PreferencesService } from '../../core/services/preferences.service';

/** What every page of the settings shares: the preferences, read and changed at once. */
@Directive()
export abstract class SettingsPage {
  protected readonly service = inject(PreferencesService);
  protected readonly prefs = this.service.preferences;

  protected set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    this.service.set(key, value);
  }
}
