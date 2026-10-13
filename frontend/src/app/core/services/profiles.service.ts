import { Injectable, computed, effect, inject } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../i18n/i18n';
import { Identity, NO_SIGNING, Profile, ProfileSigning } from '../models/settings';
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
  /**
   * Who signs commits: the profile's identity once complete, with its key when it has one;
   * git's own before.
   */
  readonly identity = computed<Identity | null>(() => {
    const profile = this.active();
    const identity = profile?.identity;
    if (!identity?.name.trim() || !identity.email.trim()) return null;
    const { format, ...signing } = profile!.signing;
    return format === 'none' || !signing.key.trim()
      ? { name: identity.name, email: identity.email }
      : { name: identity.name, email: identity.email, signing: { format, ...signing } };
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
    const profile: Profile = { id: crypto.randomUUID(), name, identity, signing: NO_SIGNING };
    this.store.update((s) => ({ ...s, profiles: [...s.profiles, profile], profileId: profile.id }));
  }

  /** The profile in use signs as `change` says from now on. */
  sign(change: Partial<ProfileSigning>) {
    const id = this.active()?.id;
    this.store.update((s) => ({
      ...s,
      profiles: s.profiles.map((p) =>
        p.id === id ? { ...p, signing: { ...p.signing, ...change } } : p,
      ),
    }));
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
