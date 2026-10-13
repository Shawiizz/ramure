import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { ProfilesService } from './core/services/profiles.service';
import { SettingsService } from './core/services/settings.service';
import { TabsService } from './core/services/tabs.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // the profiles and the tabs of the last run, before anything shows
    provideAppInitializer(() => {
      const settings = inject(SettingsService);
      const profiles = inject(ProfilesService);
      const tabs = inject(TabsService);
      return settings
        .load()
        .then(() => profiles.ensureOne())
        .then(() => tabs.restore());
    }),
  ],
};
