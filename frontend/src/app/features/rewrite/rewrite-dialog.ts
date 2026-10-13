import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Commit } from '../../core/models/repository';
import { RepositoryService } from '../../core/services/repository.service';
import { reaches } from '../../shared/ancestry';

/**
 * A commit of the current branch told again: its summary, description, author and date.
 * The commits after it are replayed on top; Undo puts the branch back.
 */
@Component({
  selector: 'app-rewrite-dialog',
  template: `
    <div class="backdrop" (mousedown)="closed.emit()">
      <form
        class="dialog"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="'Edit the commit {id}' | t: { id: commit().id.slice(0, 7) }"
        (mousedown)="$event.stopPropagation()"
        (keydown.escape)="closed.emit()"
        (submit)="$event.preventDefault(); save()"
      >
        <h2>{{ 'Edit the commit {id}' | t: { id: commit().id.slice(0, 7) } }}</h2>
        @if (pushed(); as upstream) {
          <p class="warning">
            {{
              'Already on {upstream}: once rewritten, the branch is pushed by force.'
                | t: { upstream }
            }}
          </p>
        }
        <label class="r-field">
          <span>{{ 'Summary' | t }}</span>
          <input [value]="summary()" (input)="summary.set($any($event.target).value)" />
        </label>
        <label class="r-field">
          <span>{{ 'Description' | t }}</span>
          <textarea
            rows="5"
            [value]="description()"
            (input)="description.set($any($event.target).value)"
            (keydown.control.enter)="save()"
          ></textarea>
        </label>
        <div class="pair">
          <label class="r-field">
            <span>{{ 'Author name' | t }}</span>
            <input
              [value]="name()"
              (input)="name.set($any($event.target).value)"
              spellcheck="false"
            />
          </label>
          <label class="r-field">
            <span>{{ 'Author email' | t }}</span>
            <input
              [value]="email()"
              (input)="email.set($any($event.target).value)"
              spellcheck="false"
            />
          </label>
        </div>
        <label class="r-field">
          <span>{{ 'Date' | t }}</span>
          <input
            type="datetime-local"
            step="1"
            [value]="date()"
            (input)="date.set($any($event.target).value)"
          />
        </label>
        <label class="check">
          <input
            type="checkbox"
            [checked]="commitDateToo()"
            (change)="commitDateToo.set($any($event.target).checked)"
          />
          {{ 'The commit date too, shown by most tools' | t }}
        </label>
        <div class="actions">
          @if (problem(); as problem) {
            <span class="problem">{{ problem }}</span>
          }
          <button class="r-btn r-btn--ghost" type="button" (click)="closed.emit()">
            {{ 'Cancel' | t }}
          </button>
          <button
            class="r-btn r-btn--primary"
            type="submit"
            [disabled]="!!problem() || repository.working()"
          >
            {{ 'Rewrite' | t }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: grid;
      place-items: center;
      background: rgb(0 0 0 / 0.45);
    }
    .dialog {
      width: min(520px, calc(100vw - 48px));
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 20px;
      border: 1px solid var(--r-line-strong);
      border-radius: var(--r-radius-panel);
      background: var(--r-base);
      box-shadow: 0 24px 64px rgb(0 0 0 / 0.5);
    }
    h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }
    .warning {
      margin: 0;
      padding: 8px 10px;
      border: 1px solid color-mix(in srgb, var(--r-lane-1) 45%, transparent);
      border-radius: var(--r-radius);
      background: color-mix(in srgb, var(--r-lane-1) 12%, var(--r-base));
      line-height: 1.5;
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    input[type='datetime-local'] {
      color-scheme: inherit;
    }
    .check {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--r-text-2);
      input {
        margin: 0;
        accent-color: var(--r-accent);
      }
    }
    .actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }
    .problem {
      flex: 1;
      color: var(--r-text-3);
      font-size: 12px;
    }
  `,
  imports: [TPipe],
})
export class RewriteDialog {
  protected readonly repository = inject(RepositoryService);
  readonly commit = input.required<Commit>();
  readonly closed = output();
  protected readonly summary = signal('');
  protected readonly description = signal('');
  protected readonly name = signal('');
  protected readonly email = signal('');
  /** As a `datetime-local` field holds it, in the computer's time. */
  protected readonly date = signal('');
  protected readonly commitDateToo = signal(true);

  /** The upstream already holding the commit, which a rewrite then parts from. */
  protected readonly pushed = computed(() => {
    const snapshot = this.repository.snapshot();
    const upstream = snapshot?.status.upstream?.name;
    const target = snapshot?.remoteBranches.find((b) => b.name === upstream)?.target;
    return snapshot && upstream && reaches(snapshot.commits, target, this.commit().id)
      ? upstream
      : null;
  });

  protected readonly problem = computed(() => {
    if (!this.summary().trim()) return t('A commit needs a summary.');
    if (!this.name().trim() || !this.email().trim())
      return t('The author needs a name and an email.');
    if (/[<>]/.test(this.name() + this.email())) return t('A name or an email cannot hold < or >.');
    if (Number.isNaN(new Date(this.date()).getTime())) return t('The date is not valid.');
    return null;
  });

  constructor() {
    effect(() => {
      const commit = this.commit();
      untracked(() => {
        this.summary.set(commit.summary);
        this.description.set(commit.body);
        this.name.set(commit.author);
        this.email.set(commit.email);
        this.date.set(localDate(commit.time));
      });
    });
  }

  protected async save() {
    if (this.problem() || this.repository.working()) return;
    const when = new Date(this.date());
    const description = this.description().trim();
    const done = await this.repository.rewrite(this.commit().id, {
      message: description ? `${this.summary().trim()}\n\n${description}` : this.summary().trim(),
      authorName: this.name().trim(),
      authorEmail: this.email().trim(),
      time: Math.floor(when.getTime() / 1000),
      offset: -when.getTimezoneOffset(),
      commitDateToo: this.commitDateToo(),
    });
    if (done) this.closed.emit();
  }
}

/** `seconds` as a `datetime-local` field writes it: `2026-10-13T21:05:09`. */
function localDate(seconds: number): string {
  const d = new Date(seconds * 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  return `${day}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}
