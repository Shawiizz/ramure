import { Component, computed, inject } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService } from '../../core/services/repository.service';
import { TabsService, splitPath } from '../../core/services/tabs.service';
import { pickRepository } from '../../shared/pick';
import { MenusService } from '../repository-tab/menus.service';
import { Picker } from './picker';

/** The repository of this tab, and a searchable list of the last ones to show here instead. */
@Component({
  selector: 'app-repository-picker',
  template: `
    <button
      class="trigger"
      [class.open]="open()"
      (click)="toggle()"
      [disabled]="repository.working()"
      [title]="repository.snapshot()?.path ?? ''"
    >
      <span class="caption">{{ 'Repository' | t }}</span>
      <span class="value">
        <span class="label">{{ repository.snapshot()?.name }}</span>
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
          [placeholder]="'Search a repository' | t"
          spellcheck="false"
        />
        <ul>
          @for (path of choices(); track path; let i = $index) {
            @let place = split(path);
            <li>
              <button
                [class.cursor]="i === cursor()"
                [class.head]="path === current()"
                (mouseenter)="cursor.set(i)"
                (click)="choose(path)"
                [title]="path"
              >
                @if (path === current()) {
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
                } @else {
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M2.5 4.5v8h11v-6.5H7.5L6 4.5z" />
                  </svg>
                }
                <span class="name">{{ place.name }}</span>
                <span class="parent">{{ place.parent }}</span>
              </button>
            </li>
          } @empty {
            <li class="none">{{ 'No repository by that name' | t }}</li>
          }
        </ul>
        <div class="actions">
          <button class="r-btn more" (click)="browse()">{{ 'Open a repository…' | t }}</button>
          <button class="r-btn more" (click)="open.set(false); repository.openInEditor(null)">
            {{ 'Open in {editor}' | t: { editor: menus.editor() } }}
          </button>
        </div>
      </div>
    }
  `,
  styleUrl: './picker.scss',
  imports: [TPipe],
})
export class RepositoryPicker extends Picker<string> {
  protected readonly repository = inject(RepositoryService);
  private readonly tabs = inject(TabsService);
  protected readonly menus = inject(MenusService);
  protected readonly split = splitPath;
  protected readonly current = computed(() => this.repository.snapshot()?.path ?? null);

  /** This one first, then the last opened, then those open in other tabs. */
  protected readonly choices = computed(() => {
    const current = this.current();
    const all = [...new Set([current, ...this.tabs.recent(), ...this.tabs.paths()])].filter(
      (path): path is string => !!path,
    );
    const words = this.words();
    return all.filter((path) => words.every((w) => path.toLowerCase().includes(w)));
  });

  /** Shows `path` in this tab; one open in another tab comes forward instead. */
  protected override choose(path: string) {
    this.open.set(false);
    if (path !== this.current()) this.tabs.show(this.tabs.activeId(), path);
  }

  protected async browse() {
    this.open.set(false);
    const path = await pickRepository();
    if (path) this.choose(path);
  }
}
