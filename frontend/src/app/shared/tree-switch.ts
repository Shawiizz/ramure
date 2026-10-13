import { Component, computed, inject } from '@angular/core';
import { TPipe } from '../core/i18n/t.pipe';
import { PreferencesService } from '../core/services/preferences.service';

/** Changed files as paths, or in their folders: one choice for every list of them. */
@Component({
  selector: 'app-tree-switch',
  template: `
    <div class="r-seg" role="radiogroup" [attr.aria-label]="'Changed files' | t">
      <button
        role="radio"
        [attr.aria-checked]="!tree()"
        (click)="preferences.set('fileTree', false)"
        [title]="'Each file with its path' | t"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h10" /></svg>
        {{ 'Path' | t }}
      </button>
      <button
        role="radio"
        [attr.aria-checked]="tree()"
        (click)="preferences.set('fileTree', true)"
        [title]="'The files in their folders' | t"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 3v9.5h3M3 7h3" />
          <rect x="7" y="5" width="6" height="4" rx="1" />
          <rect x="7" y="10.5" width="6" height="4" rx="1" />
        </svg>
        {{ 'Tree' | t }}
      </button>
    </div>
  `,
  styles: `
    .r-seg {
      padding: 2px;
    }
    .r-seg button {
      height: 24px;
      padding: 0 9px;
    }
  `,
  imports: [TPipe],
})
export class TreeSwitch {
  protected readonly preferences = inject(PreferencesService);
  protected readonly tree = computed(() => this.preferences.preferences().fileTree);
}
