import { Component, computed, inject, signal } from '@angular/core';
import { Channel, invoke } from '@tauri-apps/api/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { GithubRepository } from '../../core/models/github';
import { GithubService } from '../../core/services/github.service';
import { MakingDialog } from './making-dialog';

/** A remote repository copied here: its address, where, and how far the copy has got. */
@Component({
  selector: 'app-clone-dialog',
  template: `
    <div class="backdrop" (mousedown)="close()">
      <form
        class="dialog"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="'Clone a repository' | t"
        (mousedown)="$event.stopPropagation()"
        (keydown.escape)="close()"
        (submit)="$event.preventDefault(); clone()"
      >
        <h2>{{ 'Clone a repository' | t }}</h2>
        @if (github.account()) {
          <div class="mine">
            <div class="search">
              <input
                [value]="query()"
                (input)="query.set($any($event.target).value)"
                [placeholder]="'Search your GitHub repositories' | t"
                spellcheck="false"
                [disabled]="busy()"
              />
              <div class="r-seg" role="radiogroup" [attr.aria-label]="'Address' | t">
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="!ssh()"
                  (click)="ssh.set(false)"
                >
                  HTTPS
                </button>
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="ssh()"
                  (click)="ssh.set(true)"
                >
                  SSH
                </button>
              </div>
            </div>
            <ul>
              @for (repository of shown(); track repository.full_name) {
                <li>
                  <button
                    type="button"
                    [class.chosen]="url() === addressOf(repository)"
                    (click)="address(addressOf(repository))"
                    [disabled]="busy()"
                    [title]="repository.description ?? ''"
                  >
                    <span class="name">{{ repository.full_name }}</span>
                    @if (repository.private) {
                      <span class="private">{{ 'private' | t }}</span>
                    }
                  </button>
                </li>
              } @empty {
                <li class="none">
                  {{ repositories() ? ('No repository by that name' | t) : ('Reading…' | t) }}
                </li>
              }
            </ul>
          </div>
        }
        <label class="r-field">
          <span>{{ 'Its address' | t }}</span>
          <input
            class="r-mono"
            [value]="url()"
            (input)="address($any($event.target).value)"
            placeholder="https://github.com/owner/repository.git"
            spellcheck="false"
            [disabled]="busy()"
          />
        </label>
        <div class="r-field">
          <span>{{ 'In the folder' | t }}</span>
          <div class="folder">
            <input
              [value]="parent()"
              (input)="parent.set($any($event.target).value)"
              [disabled]="busy()"
            />
            <button class="r-btn" type="button" (click)="browse()" [disabled]="busy()">
              {{ 'Browse…' | t }}
            </button>
          </div>
        </div>
        <label class="r-field">
          <span>{{ 'Its own folder' | t }}</span>
          <input
            [value]="name()"
            (input)="named.set(true); name.set($any($event.target).value)"
            spellcheck="false"
            [disabled]="busy()"
          />
        </label>
        @if (busy()) {
          <div class="progress" role="progressbar" [attr.aria-valuenow]="percent()">
            <div class="bar" [style.width.%]="percent()"></div>
          </div>
          <p class="where">{{ said() }}</p>
        } @else if (where()) {
          <p class="where">{{ where() }}</p>
        }
        <div class="actions">
          @if (failure(); as failure) {
            <span class="problem">{{ failure }}</span>
          }
          <button class="r-btn r-btn--ghost" type="button" (click)="close()" [disabled]="busy()">
            {{ 'Cancel' | t }}
          </button>
          <button
            class="r-btn r-btn--primary"
            type="submit"
            [disabled]="busy() || !url().trim() || !where()"
          >
            {{ busy() ? ('Cloning…' | t) : ('Clone' | t) }}
          </button>
        </div>
      </form>
    </div>
  `,
  styleUrl: './dialog.scss',
  styles: `
    .mine {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .search {
      display: flex;
      gap: 8px;
      input {
        flex: 1;
        min-width: 0;
        padding: 7px 10px;
        border: 1px solid var(--r-line-strong);
        border-radius: var(--r-radius);
        background: var(--r-void);
        color: var(--r-text);
        font: inherit;
        &:focus {
          outline: none;
          border-color: var(--r-accent);
        }
      }
    }
    ul {
      max-height: 180px;
      margin: 0;
      padding: 4px;
      overflow-y: auto;
      border: 1px solid var(--r-line);
      border-radius: var(--r-radius);
      list-style: none;
    }
    li button {
      width: 100%;
      height: 28px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 8px;
      border: 0;
      border-radius: var(--r-radius);
      background: transparent;
      color: var(--r-text-2);
      text-align: left;
      cursor: pointer;
      &:hover:not(:disabled) {
        background: var(--r-hover);
        color: var(--r-text);
      }
      &.chosen {
        background: var(--r-hover);
        color: var(--r-accent);
      }
    }
    .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .private {
      color: var(--r-text-3);
      font-size: 11px;
    }
    .none {
      padding: 6px 8px;
      color: var(--r-text-3);
    }
    .progress {
      height: 4px;
      overflow: hidden;
      border-radius: 2px;
      background: var(--r-line);
    }
    .bar {
      height: 100%;
      background: var(--r-accent);
      transition: width var(--r-fast);
    }
  `,
  imports: [TPipe],
})
export class CloneDialog extends MakingDialog {
  protected readonly github = inject(GithubService);
  protected readonly url = signal('');
  /** The user's repositories on GitHub, once read. */
  protected readonly repositories = signal<GithubRepository[] | null>(null);
  protected readonly query = signal('');
  /** Their ssh address taken rather than their https one. */
  protected readonly ssh = signal(false);
  protected readonly shown = computed(() => {
    const words = this.query().toLowerCase().split(/\s+/).filter(Boolean);
    return (this.repositories() ?? []).filter((r) =>
      words.every((w) => r.full_name.toLowerCase().includes(w)),
    );
  });

  constructor() {
    super();
    if (this.github.account())
      this.github.repositories().then(
        (found) => this.repositories.set(found),
        (e) => this.failure.set(String(e)),
      );
  }

  protected addressOf(repository: GithubRepository): string {
    return this.ssh() ? repository.ssh_url : repository.clone_url;
  }
  /** The folder's name was typed: the address no longer gives it. */
  protected readonly named = signal(false);
  /** The last line git told of the copy. */
  protected readonly said = signal('');
  protected readonly percent = computed(() => {
    const found = [...this.said().matchAll(/(\d+)%/g)].at(-1);
    return found ? Number(found[1]) : 0;
  });

  /** The address typed; the folder takes the repository's name until named otherwise. */
  protected address(url: string) {
    this.url.set(url);
    if (!this.named()) this.name.set(repositoryName(url));
  }

  protected clone() {
    const progress = new Channel<string>();
    progress.onmessage = (line) => this.said.set(line);
    this.said.set('');
    return this.make(() =>
      invoke<string>('clone_repository', {
        url: this.url().trim(),
        parent: this.parent(),
        name: this.name().trim(),
        progress,
      }),
    );
  }
}

/** The name a repository's address ends with: `ramure` for `…/Shawiizz/ramure.git`. */
function repositoryName(url: string): string {
  const last =
    url
      .trim()
      .replace(/[\\/]+$/, '')
      .split(/[\\/:]/)
      .at(-1) ?? '';
  return last.replace(/\.git$/, '');
}
