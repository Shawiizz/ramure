import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { PreferencesService } from './core/services/preferences.service';
import { ProfilesService } from './core/services/profiles.service';
import { SettingsService } from './core/services/settings.service';
import { TabsService } from './core/services/tabs.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // the preferences, the profiles and the tabs of the last run, before anything shows
    provideAppInitializer(() => {
      const settings = inject(SettingsService);
      const preferences = inject(PreferencesService);
      const profiles = inject(ProfilesService);
      const tabs = inject(TabsService);
      return settings
        .load()
        .then(() => preferences.applyHistoryLimit())
        .then(() => profiles.ensureOne())
        .then(() => tabs.restore());
    }),
  ],
};
