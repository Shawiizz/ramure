import { Component, effect, inject, signal, untracked } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '../../../core/i18n/i18n';
import { TPipe } from '../../../core/i18n/t.pipe';
import { GithubService } from '../../../core/services/github.service';
import { ProfilesService } from '../../../core/services/profiles.service';
import { SettingsPage } from '../settings-page';

/** A public key, and the file it is in (`ssh::PublicKey`). */
interface PublicKey {
  path: string;
  text: string;
}

/** The hosts whose ssh server greets the account a key opens. */
const HOSTS: readonly string[] = ['github.com', 'gitlab.com'];

/**
 * The ssh key git signs in to remotes with: ssh's own, or one chosen or made here; its
 * public half to copy to the host, and a try of it.
 */
@Component({
  selector: 'app-ssh-page',
  template: `
    <div class="row">
      <div>
        <span class="name">{{ 'Private key' | t }}</span>
        <span class="help selectable">{{
          prefs().sshKey || ('ssh’s own, as its configuration says' | t)
        }}</span>
      </div>
      <div class="buttons">
        @if (prefs().sshKey) {
          <button class="r-btn small" (click)="set('sshKey', '')">{{ 'Use ssh’s own' | t }}</button>
        }
        <button class="r-btn small" (click)="choose()">{{ 'Choose…' | t }}</button>
      </div>
    </div>
    <div class="row column">
      <div>
        <span class="name">{{ 'Public key' | t }}</span>
        <span class="help">{{ publicKey()?.path ?? ('None found: make one below.' | t) }}</span>
      </div>
      @if (publicKey(); as key) {
        <div class="key">
          <code class="r-mono selectable">{{ key.text }}</code>
          <button class="r-btn small" (click)="copy(key.text)">
            {{ copied() ? ('Copied' | t) : ('Copy' | t) }}
          </button>
          @if (github.account()) {
            <button class="r-btn small" [disabled]="busy()" (click)="addToGithub(key.text)">
              {{ 'Add to GitHub' | t }}
            </button>
          }
        </div>
      }
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'A new key' | t }}</span>
        <span class="help">{{
          'An ed25519 key for the profile’s email, in your .ssh folder, used from then on.' | t
        }}</span>
      </div>
      <button class="r-btn small" [disabled]="busy()" (click)="generate()">
        {{ 'Make one' | t }}
      </button>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Try it' | t }}</span>
        <span class="help">{{ 'Who the host says the key opens.' | t }}</span>
      </div>
      <div class="buttons">
        @for (host of hosts; track host) {
          <button class="r-btn small" [disabled]="busy()" (click)="test(host)">{{ host }}</button>
        }
      </div>
    </div>
    @if (answer(); as answer) {
      <pre class="answer r-mono selectable">{{ answer }}</pre>
    }
    @if (failure(); as failure) {
      <p class="failure">{{ failure }}</p>
    }
  `,
  styleUrls: ['../rows.scss'],
  styles: `
    .buttons {
      flex: none;
      display: flex;
      gap: 8px;
    }
    .small {
      height: 30px;
      padding: 0 12px;
      font-size: 12px;
    }
    .column {
      flex-direction: column;
      align-items: stretch;
    }
    .key {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      code {
        flex: 1;
        min-width: 0;
        padding: 8px 10px;
        border: 1px solid var(--r-line-strong);
        border-radius: var(--r-radius);
        background: var(--r-void);
        font-size: 11.5px;
        overflow-wrap: anywhere;
      }
    }
    .answer {
      margin: 14px 0 0;
      padding: 10px 12px;
      border-radius: var(--r-radius);
      background: var(--r-void);
      color: var(--r-text-2);
      font-size: 12px;
      white-space: pre-wrap;
    }
  `,
  imports: [TPipe],
})
export class SshPage extends SettingsPage {
  private readonly profiles = inject(ProfilesService);
  protected readonly github = inject(GithubService);
  protected readonly hosts = HOSTS;
  protected readonly publicKey = signal<PublicKey | null>(null);
  protected readonly copied = signal(false);
  protected readonly busy = signal(false);
  protected readonly answer = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  constructor() {
    super();
    effect(() => {
      const key = this.prefs().sshKey || null;
      untracked(() =>
        invoke<PublicKey | null>('ssh_public_key', { key }).then(
          (found) => this.publicKey.set(found),
          (e) => this.failure.set(String(e)),
        ),
      );
    });
  }

  protected async choose() {
    const key = await open({ title: t('The private key'), directory: false });
    if (typeof key === 'string') this.set('sshKey', key);
  }

  protected copy(text: string) {
    void navigator.clipboard.writeText(text);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }

  protected async generate() {
    const email = this.profiles.identity()?.email ?? '';
    await this.run(async () => this.set('sshKey', await invoke<string>('ssh_generate', { email })));
  }

  /** The public key added to the GitHub account, named after this computer's key. */
  protected async addToGithub(key: string) {
    const title = `Ramure (${key.split(' ').at(2) ?? 'ssh'})`;
    await this.run(async () => {
      await invoke('github_add_ssh_key', { title, key });
      this.answer.set(t('Added to GitHub as “{title}”.', { title }));
    });
  }

  protected async test(host: string) {
    await this.run(async () => this.answer.set(await invoke<string>('ssh_test', { host })));
  }

  /** One thing at a time, its failure told. */
  private async run(act: () => Promise<void>) {
    this.busy.set(true);
    this.failure.set(null);
    this.answer.set(null);
    try {
      await act();
    } catch (e) {
      this.failure.set(String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
