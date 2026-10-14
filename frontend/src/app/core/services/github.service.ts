import { Injectable, inject, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { DeviceCode, GithubAccount, GithubRepository, Polled } from '../models/github';
import { GravatarService } from './gravatar.service';

/** The code being typed on GitHub to sign in. */
export interface SigningIn {
  code: string;
  uri: string;
}

/**
 * The GitHub account Ramure is signed in to: signing in with a code typed on github.com,
 * signing out; the pictures GitHub has of a repository's authors.
 */
@Injectable({ providedIn: 'root' })
export class GithubService {
  private readonly pictures = inject(GravatarService);
  readonly account = signal<GithubAccount | null>(null);
  readonly signingIn = signal<SigningIn | null>(null);
  readonly failure = signal<string | null>(null);
  /** Bumped by every new start or cancel: a poll of an older one stops. */
  private attempt = 0;
  /** The repositories whose authors' pictures were asked for. */
  private readonly pictured = new Set<string>();

  constructor() {
    invoke<GithubAccount | null>('github_account').then(
      (account) => this.account.set(account),
      (e) => console.warn('GitHub account not read', e),
    );
  }

  /** Shows the code to type, opens GitHub's page for it, and waits until it is typed. */
  async signIn(): Promise<void> {
    const attempt = ++this.attempt;
    this.failure.set(null);
    try {
      const device = await invoke<DeviceCode>('github_device_start');
      this.signingIn.set({ code: device.user_code, uri: device.verification_uri });
      void this.openPage(device.verification_uri);
      let wait = device.interval;
      const deadline = Date.now() + device.expires_in * 1000;
      while (attempt === this.attempt && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        if (attempt !== this.attempt) return;
        const polled = await invoke<Polled>('github_device_poll', {
          deviceCode: device.device_code,
        });
        if (polled.state === 'slowDown') wait += 5;
        if (polled.state === 'done') {
          this.account.set(polled.account);
          break;
        }
      }
    } catch (e) {
      if (attempt === this.attempt) this.failure.set(String(e));
    }
    if (attempt === this.attempt) this.signingIn.set(null);
  }

  /** A page of GitHub's, in the browser. */
  async openPage(url: string): Promise<void> {
    try {
      await invoke('open_url', { url });
    } catch (e) {
      this.failure.set(String(e));
    }
  }

  cancel() {
    this.attempt++;
    this.signingIn.set(null);
  }

  async signOut(): Promise<void> {
    await invoke('github_sign_out');
    this.account.set(null);
  }

  repositories(): Promise<GithubRepository[]> {
    return invoke<GithubRepository[]>('github_repositories');
  }

  /** The pictures GitHub has of the authors of `repository` (`owner/name`), once. */
  async picture(repository: string): Promise<void> {
    if (!this.account() || this.pictured.has(repository)) return;
    this.pictured.add(repository);
    try {
      this.pictures.learn(await invoke<Record<string, string>>('github_avatars', { repository }));
    } catch (e) {
      console.warn('GitHub pictures not read', e);
    }
  }
}
