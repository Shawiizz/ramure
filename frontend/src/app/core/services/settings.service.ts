import { Injectable, computed, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Layout, NO_SETTINGS, Settings, parseSettings } from '../models/settings';

/** The settings one window wrote, told to the others. */
interface Saved {
  from: string;
  settings: Settings;
}

/**
 * What Ramure remembers between runs, read once at startup and written on every change.
 * Every window holds them: what one writes, the others take, so none writes back older ones.
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly settings = signal<Settings>(NO_SETTINGS);
  readonly layout = computed(() => this.settings().layout);
  private readonly window = getCurrentWindow().label;
  private writing: Promise<void> = Promise.resolve();
  private queued = false;

  async load(): Promise<void> {
    try {
      this.settings.set(parseSettings(await invoke<unknown>('load_settings')));
    } catch (e) {
      console.error('settings not read', e);
    }
    await listen<Saved>('settings-saved', ({ payload }) => {
      if (payload.from !== this.window) this.settings.set(parseSettings(payload.settings));
    });
  }

  /** The panels' sizes and order, changed in part. */
  setLayout(change: Partial<Layout>) {
    this.update((s) => ({ ...s, layout: { ...s.layout, ...change } }));
  }

  update(change: (settings: Settings) => Settings) {
    this.settings.update(change);
    this.save();
  }

  /** One write at a time, each with the latest settings; changes made meanwhile share one. */
  private save() {
    if (this.queued) return;
    this.queued = true;
    this.writing = this.writing.then(async () => {
      this.queued = false;
      try {
        const settings = this.settings();
        await invoke('save_settings', { settings });
        await emit('settings-saved', { from: this.window, settings } satisfies Saved);
      } catch (e) {
        console.error('settings not saved', e);
      }
    });
  }
}
