import { Component, computed, inject } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService } from '../../core/services/repository.service';
import { Picker } from './picker';

interface Choice {
  name: string;
  remote: boolean;
  head: boolean;
}

/** The current branch, and a searchable list of the others to switch to. */
@Component({
  selector: 'app-branch-picker',
  template: `
    <button
      class="trigger"
      [class.open]="open()"
      (click)="toggle()"
      [disabled]="repository.working()"
      [title]="'Switch to another branch' | t"
    >
      <span class="caption">{{ 'Branch' | t }}</span>
      <span class="value">
        <span class="label r-mono">{{ head() }}</span>
        <svg class="caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
      </span>
    </button>
    @if (open()) {
      <div class="backdrop" (click)="open.set(false)"></div>
      <div class="r-popover" (keydown)="key($event)">
        <input
          #search
          class="search"
          [value]="query()"
          (input)="query.set($any($event.target).value); cursor.set(0)"
          [placeholder]="'Search a branch' | t"
          spellcheck="false"
        />
        <ul>
          @for (choice of choices(); track choice.remote + choice.name; let i = $index) {
            <li>
              <button
                [class.cursor]="i === cursor()"
                [class.head]="choice.head"
                (mouseenter)="cursor.set(i)"
                (click)="choose(choice)"
              >
                @if (choice.remote) {
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4.5 12.5h7a3 3 0 0 0 .4-6 4 4 0 0 0-7.7 1A2.5 2.5 0 0 0 4.5 12.5z" />
                  </svg>
                } @else if (choice.head) {
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
                } @else {
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="5" cy="3.5" r="1.6" />
                    <circle cx="5" cy="12.5" r="1.6" />
                    <circle cx="11" cy="5.5" r="1.6" />
                    <path d="M5 5.1v5.8M11 7.1c0 2.4-3 2.6-5.4 4" />
                  </svg>
                }
                <span class="name">{{ choice.name }}</span>
              </button>
            </li>
          } @empty {
            <li class="none">{{ 'No branch by that name' | t }}</li>
          }
        </ul>
      </div>
    }
  `,
  styleUrl: './picker.scss',
  imports: [TPipe],
})
export class BranchPicker extends Picker<Choice> {
  protected readonly repository = inject(RepositoryService);

  protected readonly head = computed(() => {
    const head = this.repository.snapshot()?.head;
    if (!head) return '';
    return head.kind === 'detached' ? head.id.slice(0, 7) : head.name;
  });

  /** HEAD's branch, the other local ones, then the remote ones with no local branch yet. */
  protected readonly choices = computed<Choice[]>(() => {
    const snapshot = this.repository.snapshot();
    if (!snapshot) return [];
    const head = snapshot.head.kind === 'branch' ? snapshot.head.name : null;
    const local = new Set(snapshot.branches.map((b) => b.name));
    const all: Choice[] = [
      ...snapshot.branches
        .map((b) => ({ name: b.name, remote: false, head: b.name === head }))
        .sort((a, b) => +b.head - +a.head),
      ...snapshot.remoteBranches
        .filter((b) => !local.has(b.name.slice(b.name.indexOf('/') + 1)))
        .map((b) => ({ name: b.name, remote: true, head: false })),
    ];
    const words = this.words();
    return all.filter((c) => words.every((w) => c.name.toLowerCase().includes(w)));
  });

  protected override async choose(choice: Choice) {
    this.open.set(false);
    if (!choice.head) await this.repository.checkout(choice.name, choice.remote);
  }
}
