import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '../../../core/i18n/i18n';
import { TPipe } from '../../../core/i18n/t.pipe';
import { ProfileSigning } from '../../../core/models/settings';
import { ProfilesService } from '../../../core/services/profiles.service';
import { SettingsPage } from '../settings-page';

/** A GPG secret key (`ssh::GpgKey`). */
interface GpgKey {
  id: string;
  user: string;
}

/** How the profile in use signs its commits and tags: with an ssh key, a GPG key, or not. */
@Component({
  selector: 'app-signing-page',
  template: `
    <p class="for">{{ 'For the profile {name}.' | t: { name: profileName() } }}</p>
    <div class="row">
      <div>
        <span class="name">{{ 'Sign with' | t }}</span>
        <span class="help">{{
          'Hosts show the commits signed with a key they know as verified.' | t
        }}</span>
      </div>
      <div class="seg" role="radiogroup" [attr.aria-label]="'Sign with' | t">
        @for (format of formats; track format) {
          <button
            role="radio"
            [attr.aria-checked]="signing().format === format"
            (click)="choose(format)"
          >
            {{ formatNames()[format] }}
          </button>
        }
      </div>
    </div>
    @switch (signing().format) {
      @case ('ssh') {
        <div class="row">
          <div>
            <span class="name">{{ 'Key' | t }}</span>
            <span class="help selectable">{{ signing().key || ('None chosen' | t) }}</span>
          </div>
          <button class="r-btn small" (click)="chooseFile()">{{ 'Choose…' | t }}</button>
        </div>
      }
      @case ('openpgp') {
        <div class="row">
          <div>
            <span class="name">{{ 'Key' | t }}</span>
            <span class="help">{{
              keys().length ? ('One of gpg’s secret keys.' | t) : ('gpg has no secret key.' | t)
            }}</span>
          </div>
          <div class="buttons">
            <select
              class="field"
              (change)="sign({ key: $any($event.target).value })"
              [attr.aria-label]="'Key' | t"
            >
              <option value="" [selected]="!signing().key">{{ 'None chosen' | t }}</option>
              @for (key of keys(); track key.id) {
                <option [value]="key.id" [selected]="key.id === signing().key">
                  {{ key.user }} · {{ key.id }}
                </option>
              }
            </select>
            <button
              class="r-btn small"
              (click)="list()"
              [attr.aria-label]="'List the keys again' | t"
            >
              ↻
            </button>
          </div>
        </div>
      }
    }
    @if (signing().format !== 'none') {
      <div class="row">
        <div>
          <span class="name">{{ 'Program' | t }}</span>
          <span class="help">{{ 'The one signing, by its command or its path.' | t }}</span>
        </div>
        <input
          class="field r-mono"
          [value]="signing().program"
          (change)="sign({ program: $any($event.target).value.trim() })"
          [placeholder]="signing().format === 'ssh' ? 'ssh-keygen' : 'gpg'"
          spellcheck="false"
        />
      </div>
      <div class="row">
        <div>
          <span class="name">{{ 'Sign the commits' | t }}</span>
        </div>
        <button
          class="switch"
          role="switch"
          [attr.aria-checked]="signing().commits"
          [attr.aria-label]="'Sign the commits' | t"
          (click)="sign({ commits: !signing().commits })"
        ></button>
      </div>
      <div class="row">
        <div>
          <span class="name">{{ 'Sign the tags' | t }}</span>
          <span class="help">{{ 'The annotated ones.' | t }}</span>
        </div>
        <button
          class="switch"
          role="switch"
          [attr.aria-checked]="signing().tags"
          [attr.aria-label]="'Sign the tags' | t"
          (click)="sign({ tags: !signing().tags })"
        ></button>
      </div>
    }
  `,
  styleUrl: '../rows.scss',
  styles: `
    .for {
      margin: 0 0 6px;
      color: var(--r-text-3);
    }
    .buttons {
      flex: none;
      display: flex;
      gap: 8px;
    }
    .small {
      height: 32px;
      padding: 0 12px;
      font-size: 12px;
    }
  `,
  imports: [TPipe],
})
export class SigningPage extends SettingsPage {
  private readonly profiles = inject(ProfilesService);
  protected readonly formats: readonly ProfileSigning['format'][] = ['none', 'ssh', 'openpgp'];
  protected readonly signing = computed(() => this.profiles.active()!.signing);
  protected readonly profileName = computed(() => this.profiles.active()?.name ?? '');
  protected readonly keys = signal<GpgKey[]>([]);
  protected readonly formatNames = computed<Record<ProfileSigning['format'], string>>(() => ({
    none: t('Nothing'),
    ssh: t('An ssh key'),
    openpgp: t('A GPG key'),
  }));

  constructor() {
    super();
    effect(() => {
      if (this.signing().format === 'openpgp') untracked(() => this.list());
    });
  }

  protected sign(change: Partial<ProfileSigning>) {
    this.profiles.sign(change);
  }

  /** Another kind of key: an ssh one starts as the key git signs in with, a GPG one unchosen. */
  protected choose(format: ProfileSigning['format']) {
    if (format !== this.signing().format)
      this.sign({ format, key: format === 'ssh' ? this.prefs().sshKey : '' });
  }

  protected async chooseFile() {
    const key = await open({ title: t('The private key'), directory: false });
    if (typeof key === 'string') this.sign({ key });
  }

  protected async list() {
    this.keys.set(await invoke<GpgKey[]>('gpg_keys', { program: this.signing().program }));
  }
}
