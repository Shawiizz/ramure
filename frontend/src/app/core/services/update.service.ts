import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { Update, check } from '@tauri-apps/plugin-updater';

/** How often a newer release is looked for, while Ramure runs. */
const EVERY = 6 * 60 * 60 * 1000;

/**
 * The version running, and a newer release once one is published on GitHub: downloaded,
 * its signature checked, installed, and Ramure started again in it.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  readonly version = signal('');
  readonly available = signal<Update | null>(null);
  /** While the update downloads: the share done, from 0 to 1. */
  readonly progress = signal<number | null>(null);
  /** Why the last update failed. */
  readonly failure = signal<string | null>(null);

  constructor() {
    getVersion().then((v) => this.version.set(v));
    void this.check();
    const timer = setInterval(() => this.check(), EVERY);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Looks for a newer release; offline, or with none published, nothing is offered. */
  async check(): Promise<void> {
    try {
      this.available.set(await check());
    } catch (e) {
      console.warn('no release information', e);
    }
  }

  async install(): Promise<void> {
    const update = this.available();
    if (!update || this.progress() !== null) return;
    let total = 0;
    let done = 0;
    this.failure.set(null);
    this.progress.set(0);
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0;
        else if (event.event === 'Progress') {
          done += event.data.chunkLength;
          if (total) this.progress.set(Math.min(1, done / total));
        }
      });
      await relaunch();
    } catch (e) {
      this.progress.set(null);
      this.failure.set(String(e));
    }
  }
}
