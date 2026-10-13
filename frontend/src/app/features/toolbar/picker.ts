import { Directive, ElementRef, Signal, effect, inject, signal, viewChild } from '@angular/core';

/**
 * What the toolbar's pickers share: open or not, the search typed, the choice under the
 * cursor, moved with the arrow keys and taken with Enter.
 */
@Directive()
export abstract class Picker<T> {
  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly cursor = signal(0);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  /** The choices matching the search, in their order. */
  protected abstract readonly choices: Signal<T[]>;

  constructor() {
    effect(() => this.search()?.nativeElement.focus());
  }

  protected abstract choose(choice: T): void;

  /** Every word typed, in lower case: a choice must hold them all. */
  protected words(): string[] {
    return this.query().toLowerCase().split(/\s+/).filter(Boolean);
  }

  protected toggle() {
    this.open.set(!this.open());
    this.query.set('');
    this.cursor.set(0);
  }

  protected key(event: KeyboardEvent) {
    const count = this.choices().length;
    if (event.key === 'Escape') this.open.set(false);
    else if (event.key === 'ArrowDown' && count) this.move((this.cursor() + 1) % count);
    else if (event.key === 'ArrowUp' && count) this.move((this.cursor() - 1 + count) % count);
    else if (event.key === 'Enter' && count) this.choose(this.choices()[this.cursor()]);
    else return;
    event.preventDefault();
  }

  /** Moves the cursor, keeping its choice in view once drawn. */
  private move(index: number) {
    this.cursor.set(index);
    requestAnimationFrame(() =>
      this.host.nativeElement.querySelector('.cursor')?.scrollIntoView({ block: 'nearest' }),
    );
  }
}
