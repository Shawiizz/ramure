import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { FileCommit } from '../../core/models/repository';
import { RepositoryService } from '../../core/services/repository.service';
import { Avatar } from '../../shared/avatar';
import { when } from '../../shared/when';
import { DiffView } from '../diff/diff-view';

/** The commits that changed a file, newest first; the one picked shows its diff beside. */
@Component({
  selector: 'app-file-history',
  template: `
    <div class="split">
      <ol class="commits" [attr.aria-label]="'Commits that changed the file' | t">
        @if (failure(); as failure) {
          <li class="note error">{{ failure }}</li>
        } @else if (commits(); as commits) {
          @for (commit of commits; track commit.id) {
            <li>
              <button
                class="commit"
                [class.picked]="commit.id === picked()"
                (click)="pick(commit)"
                [title]="commit.summary"
              >
                <app-avatar [name]="commit.author" [email]="commit.email" [size]="24" />
                <span class="text">
                  <span class="summary">{{ commit.summary }}</span>
                  <span class="meta">
                    {{ commit.author }} · {{ when(commit.time) }} ·
                    <span class="r-mono">{{ commit.id.slice(0, 7) }}</span>
                  </span>
                </span>
              </button>
            </li>
          } @empty {
            <li class="note">{{ 'No commit changed this file.' | t }}</li>
          }
        } @else {
          <li class="note">{{ 'Reading…' | t }}</li>
        }
      </ol>
      <div class="diff">
        @if (repository.diff()) {
          <app-diff-view />
        } @else {
          <p class="note">{{ 'Pick a commit to see what it changed.' | t }}</p>
        }
      </div>
    </div>
  `,
  styles: `
    .split {
      height: 100%;
      display: grid;
      grid-template-columns: minmax(220px, 30%) 1fr;
    }
    .commits {
      margin: 0;
      padding: 4px 0;
      overflow-y: auto;
      border-right: 1px solid var(--r-line);
      background: var(--r-base);
      list-style: none;
    }
    .commit {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 12px;
      border: 0;
      background: transparent;
      text-align: left;
      cursor: pointer;
      &:hover {
        background: var(--r-hover);
      }
      &.picked {
        background: var(--r-raised);
        box-shadow: inset 2px 0 var(--r-accent);
      }
    }
    .text {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .summary,
    .meta {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      color: var(--r-text-3);
      font-size: 12px;
    }
    .diff {
      position: relative;
      min-width: 0;
    }
    app-diff-view {
      position: absolute;
      inset: 0;
    }
    .note {
      margin: 0;
      padding: 24px 16px;
      color: var(--r-text-3);
      text-align: center;
      &.error {
        color: var(--r-danger);
        user-select: text;
      }
    }
  `,
  imports: [TPipe, Avatar, DiffView],
})
export class FileHistory {
  protected readonly repository = inject(RepositoryService);
  readonly path = input.required<string>();
  protected readonly commits = signal<FileCommit[] | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly picked = signal<string | null>(null);
  protected readonly when = when;

  constructor() {
    effect(() => {
      const file = this.path();
      untracked(() => this.read(file));
    });
  }

  /** Shows what a commit did to the file, and the commit in the details. */
  protected pick(commit: FileCommit) {
    this.picked.set(commit.id);
    this.repository.select(commit.id);
    this.repository.showDiff(commit.change, { kind: 'commit', id: commit.id });
  }

  private async read(file: string) {
    const path = this.repository.snapshot()?.path;
    this.commits.set(null);
    this.failure.set(null);
    if (!path) return;
    try {
      const commits = await invoke<FileCommit[]>('file_history', { path, file });
      if (this.path() !== file) return;
      this.commits.set(commits);
      if (commits.length) this.pick(commits[0]);
    } catch (e) {
      this.failure.set(String(e));
    }
  }
}
