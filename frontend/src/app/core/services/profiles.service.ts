import { Injectable, computed, effect, inject } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../i18n/i18n';
import { Identity, Profile } from '../models/settings';
import { SettingsService } from './settings.service';

/** The profiles to commit as, and the one in use. */
@Injectable({ providedIn: 'root' })
export class ProfilesService {
  private readonly store = inject(SettingsService);
  readonly profiles = computed(() => this.store.settings().profiles);
  readonly active = computed<Profile | null>(() => {
    const { profiles, profileId } = this.store.settings();
    return profiles.find((p) => p.id === profileId) ?? profiles[0] ?? null;
  });
  /** Who signs commits: the profile's identity once complete, git's own before. */
  readonly identity = computed<Identity | null>(() => {
    const identity = this.active()?.identity;
    return identity?.name.trim() && identity.email.trim() ? identity : null;
  });

  constructor() {
    // git run outside Ramure signs as the profile in use, when the settings say so
    effect(() => {
      const identity = this.identity();
      if (identity && this.store.settings().preferences.syncGitConfig)
        invoke('set_global_identity', { identity }).catch((e) =>
          console.error('global identity not set', e),
        );
    });
  }

  /** The first run: a profile with the identity git already has. */
  async ensureOne(): Promise<void> {
    if (this.profiles().length) return;
    let identity: Identity = { name: '', email: '' };
    try {
      identity = await invoke<Identity>('global_identity');
    } catch (e) {
      console.error('no global identity', e);
    }
    this.add(t('Default profile'), identity);
  }

  use(id: string) {
    this.store.update((s) => ({ ...s, profileId: id }));
  }

  /** A new profile, put in use. */
  add(name: string, identity: Identity) {
    const profile: Profile = { id: crypto.randomUUID(), name, identity };
    this.store.update((s) => ({ ...s, profiles: [...s.profiles, profile], profileId: profile.id }));
  }

  edit(id: string, name: string, identity: Identity) {
    this.store.update((s) => ({
      ...s,
      profiles: s.profiles.map((p) => (p.id === id ? { ...p, name, identity } : p)),
    }));
  }

  /** Removes a profile; the last one stays. */
  remove(id: string) {
    this.store.update((s) =>
      s.profiles.length > 1
        ? {
            ...s,
            profiles: s.profiles.filter((p) => p.id !== id),
            profileId: s.profileId === id ? null : s.profileId,
          }
        : s,
    );
  }
}
