import { Component, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { locale, t } from '../../../core/i18n/i18n';
import { TPipe } from '../../../core/i18n/t.pipe';
import { AUTO_FETCH_MINUTES, HISTORY_LIMITS } from '../../../core/models/settings';
import { SettingsPage } from '../settings-page';

/** The global git configuration's keys this page sets. */
type GlobalKey = 'core.longpaths' | 'core.autocrlf' | 'init.defaultBranch';

/** How line endings are turned, as `core.autocrlf` says. */
const AUTOCRLF: readonly string[] = ['true', 'input', 'false'];

/**
 * Fetching, the history read, the global identity; and the global git configuration, as
 * git itself keeps it, for every tool.
 */
@Component({
  selector: 'app-git-page',
  template: `
    <div class="row">
      <div>
        <span class="name">{{ 'Fetch on its own' | t }}</span>
        <span class="help">{{
          'Brings what the remotes have new, in every open repository.' | t
        }}</span>
      </div>
      <div class="seg" role="radiogroup" [attr.aria-label]="'Fetch on its own' | t">
        @for (n of autoFetch; track n) {
          <button
            role="radio"
            [attr.aria-checked]="prefs().autoFetchMinutes === n"
            (click)="set('autoFetchMinutes', n)"
          >
            {{ minutes(n) }}
          </button>
        }
      </div>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Prune on fetch' | t }}</span>
        <span class="help">{{ 'Remote branches deleted on their remote go here too.' | t }}</span>
      </div>
      <button
        class="switch"
        role="switch"
        [attr.aria-checked]="prefs().prune"
        [attr.aria-label]="'Prune on fetch' | t"
        (click)="set('prune', !prefs().prune)"
      ></button>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Commits in the history' | t }}</span>
        <span class="help">{{
          'Read at first; more reach further back, and take longer.' | t
        }}</span>
      </div>
      <div class="seg" role="radiogroup" [attr.aria-label]="'Commits in the history' | t">
        @for (n of historyLimits; track n) {
          <button
            role="radio"
            [attr.aria-checked]="prefs().historyLimit === n"
            (click)="set('historyLimit', n)"
          >
            {{ count(n) }}
          </button>
        }
      </div>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Read older commits on the way' | t }}</span>
        <span class="help">{{ 'Scrolled to its end, the history reads as many again.' | t }}</span>
      </div>
      <button
        class="switch"
        role="switch"
        [attr.aria-checked]="prefs().lazyHistory"
        [attr.aria-label]="'Read older commits on the way' | t"
        (click)="set('lazyHistory', !prefs().lazyHistory)"
      ></button>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'The global identity follows the profile' | t }}</span>
        <span class="help">{{
          'git run outside Ramure, in its terminal too, signs as the profile in use.' | t
        }}</span>
      </div>
      <button
        class="switch"
        role="switch"
        [attr.aria-checked]="prefs().syncGitConfig"
        [attr.aria-label]="'The global identity follows the profile' | t"
        (click)="set('syncGitConfig', !prefs().syncGitConfig)"
      ></button>
    </div>

    <p class="group">{{ 'Global git configuration' | t }}</p>
    <div class="row">
      <div>
        <span class="name">{{ 'Long paths' | t }}</span>
        <span class="help">{{
          'core.longpaths: paths longer than Windows’ 260 characters.' | t
        }}</span>
      </div>
      <button
        class="switch"
        role="switch"
        [attr.aria-checked]="config()['core.longpaths'] === 'true'"
        [attr.aria-label]="'Long paths' | t"
        (click)="
          setConfig('core.longpaths', config()['core.longpaths'] === 'true' ? 'false' : 'true')
        "
      ></button>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Line endings' | t }}</span>
        <span class="help">{{
          'core.autocrlf: CRLF written out and LF kept, LF kept only, or left as they are.' | t
        }}</span>
      </div>
      <div class="seg" role="radiogroup" [attr.aria-label]="'Line endings' | t">
        @for (value of autocrlf; track value) {
          <button
            role="radio"
            class="r-mono"
            [attr.aria-checked]="(config()['core.autocrlf'] ?? 'false') === value"
            (click)="setConfig('core.autocrlf', value)"
          >
            {{ value }}
          </button>
        }
      </div>
    </div>
    <div class="row">
      <div>
        <span class="name">{{ 'Default branch' | t }}</span>
        <span class="help">{{
          'init.defaultBranch: the first branch of a new repository.' | t
        }}</span>
      </div>
      <input
        class="field small r-mono"
        [value]="config()['init.defaultBranch'] ?? ''"
        (change)="setConfig('init.defaultBranch', $any($event.target).value.trim() || null)"
        placeholder="master"
        spellcheck="false"
      />
    </div>
    @if (failure(); as failure) {
      <p class="failure">{{ failure }}</p>
    }
  `,
  styleUrl: '../rows.scss',
  imports: [TPipe],
})
export class GitPage extends SettingsPage {
  protected readonly autoFetch = AUTO_FETCH_MINUTES;
  protected readonly historyLimits = HISTORY_LIMITS;
  protected readonly autocrlf = AUTOCRLF;
  /** The global configuration's values, unset ones left out. */
  protected readonly config = signal<Partial<Record<GlobalKey, string>>>({});
  protected readonly failure = signal<string | null>(null);

  constructor() {
    super();
    const keys: GlobalKey[] = ['core.longpaths', 'core.autocrlf', 'init.defaultBranch'];
    invoke<Partial<Record<GlobalKey, string>>>('global_config', { keys }).then(
      (config) => this.config.set(config),
      (e) => this.failure.set(String(e)),
    );
  }

  /** Writes a key of the global configuration, or unsets it with null. */
  protected async setConfig(key: GlobalKey, value: string | null) {
    try {
      await invoke('set_global_config', { key, value });
      this.config.update((config) => {
        const next = { ...config };
        if (value === null) delete next[key];
        else next[key] = value;
        return next;
      });
      this.failure.set(null);
    } catch (e) {
      this.failure.set(String(e));
    }
  }

  protected count(n: number): string {
    return n.toLocaleString(locale());
  }

  protected minutes(n: number): string {
    return n ? t('Every {n} min', { n }) : t('Never');
  }
}
