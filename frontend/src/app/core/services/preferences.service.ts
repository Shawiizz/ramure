import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { Preferences, ZOOMS } from '../models/settings';
import { SettingsService } from './settings.service';

/**
 * How Ramure behaves, as the settings say: read by the features, changed by the settings
 * dialog. The theme, the zoom and the history's length take effect here.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly store = inject(SettingsService);
  readonly preferences = computed(() => this.store.settings().preferences);
  /** The settings dialog is open. */
  readonly open = signal(false);
  private readonly systemLight = signal(matchMedia('(prefers-color-scheme: light)').matches);

  /** The theme shown: the system's when it is followed. */
  readonly theme = computed(() => {
    const theme = this.preferences().theme;
    return theme === 'system' ? (this.systemLight() ? 'light' : 'dark') : theme;
  });

  constructor() {
    const query = matchMedia('(prefers-color-scheme: light)');
    const follow = (e: MediaQueryListEvent) => this.systemLight.set(e.matches);
    query.addEventListener('change', follow);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', follow));
    effect(() => (document.documentElement.dataset['theme'] = this.theme()));
    effect(() => {
      getCurrentWebview()
        .setZoom(this.preferences().zoom)
        .catch((e) => console.error('zoom not set', e));
    });
  }

  /** One step closer, or further (a negative `steps`); back to 1 with none. */
  zoom(steps: number) {
    const at = ZOOMS.indexOf(this.preferences().zoom);
    const to = steps ? ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, at + steps))] : 1;
    this.set('zoom', to);
  }

  set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    this.store.update((s) => ({ ...s, preferences: { ...s.preferences, [key]: value } }));
    if (key === 'historyLimit') void this.applyHistoryLimit();
  }

  /** Tells the backend how many commits to read; before the first repository opens. */
  async applyHistoryLimit(): Promise<void> {
    try {
      await invoke('set_history_limit', { limit: this.preferences().historyLimit });
    } catch (e) {
      console.error('history limit not set', e);
    }
  }
}
