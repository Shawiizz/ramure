import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TPipe } from '../core/i18n/t.pipe';

/** A field to fill in a question. */
export interface AskField {
  label: string;
  placeholder?: string;
  /** A long text, on several lines (a message). */
  multiline?: boolean;
  /** Text written with a monospace font (a branch or tag name). */
  code?: boolean;
  /** What the field holds at first (a name to change). */
  value?: string;
}

/** A question to the user: a title, what is at stake, the fields to fill, the answer's word. */
export interface Ask {
  title: string;
  text?: string;
  fields: AskField[];
  confirm: string;
  /** The answer throws something away. */
  danger?: boolean;
  answered: (values: string[]) => void;
}

/** A small dialog asking for a few words, or only for a yes. */
@Component({
  selector: 'app-ask-dialog',
  template: `
    <div class="backdrop" (mousedown)="cancelled.emit()">
      <form
        class="dialog"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="ask().title"
        (mousedown)="$event.stopPropagation()"
        (keydown.escape)="cancelled.emit()"
        (submit)="$event.preventDefault(); answer()"
      >
        <h2>{{ ask().title }}</h2>
        @if (ask().text) {
          <p>{{ ask().text }}</p>
        }
        @for (field of ask().fields; track $index; let i = $index) {
          <label class="r-field">
            <span>{{ field.label }}</span>
            @if (field.multiline) {
              <textarea
                rows="4"
                [placeholder]="field.placeholder ?? ''"
                [value]="values()[i] ?? field.value ?? ''"
                (input)="write(i, $any($event.target).value)"
                (keydown.control.enter)="answer()"
              ></textarea>
            } @else {
              <input
                [class.r-mono]="field.code"
                [placeholder]="field.placeholder ?? ''"
                [value]="values()[i] ?? field.value ?? ''"
                (input)="write(i, $any($event.target).value)"
                spellcheck="false"
              />
            }
          </label>
        }
        <div class="actions">
          <button class="r-btn r-btn--ghost" type="button" (click)="cancelled.emit()">
            {{ 'Cancel' | t }}
          </button>
          <button
            class="r-btn"
            [class.r-btn--primary]="!ask().danger"
            [class.danger]="ask().danger"
            type="submit"
            [disabled]="!complete()"
          >
            {{ ask().confirm }}
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
      width: min(420px, calc(100vw - 48px));
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
    p {
      margin: 0;
      color: var(--r-text-2);
      line-height: 1.5;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .danger {
      border-color: transparent;
      background: var(--r-danger);
      color: var(--r-on-accent);
    }
  `,
  imports: [TPipe],
})
export class AskDialog {
  readonly ask = input.required<Ask>();
  readonly cancelled = output();
  protected readonly values = signal<string[]>([]);
  /** Every one-line field filled; a long text may stay empty. */
  protected readonly complete = computed(() =>
    this.ask().fields.every((f, i) => f.multiline || !!this.values()[i]?.trim()),
  );
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => {
      this.values.set(this.ask().fields.map((f) => f.value ?? ''));
      const first = this.host.nativeElement.querySelector<HTMLElement>(
        'input, textarea, button[type=submit]',
      );
      first?.focus();
      if (first instanceof HTMLInputElement) first.select();
    });
  }

  protected write(index: number, value: string) {
    this.values.update((values) => values.map((v, i) => (i === index ? value : v)));
  }

  protected answer() {
    if (!this.complete()) return;
    this.ask().answered(this.values().map((v) => v.trim()));
  }
}
