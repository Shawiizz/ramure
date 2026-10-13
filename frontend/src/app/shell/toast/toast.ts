import { Component, inject } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService } from '../../core/services/repository.service';

/** What git answered when something failed, until it is dismissed. */
@Component({
  selector: 'app-toast',
  template: `
    @if (repository.error(); as error) {
      <div class="toast" role="alert">
        <p>{{ error }}</p>
        <button class="r-btn r-btn--ghost" (click)="repository.error.set(null)">
          {{ 'Dismiss' | t }}
        </button>
      </div>
    }
  `,
  styles: `
    .toast {
      position: fixed;
      left: 50%;
      bottom: 20px;
      z-index: 20;
      transform: translateX(-50%);
      width: min(640px, calc(100vw - 32px));
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 12px 12px 16px;
      border: 1px solid color-mix(in srgb, var(--r-danger) 50%, transparent);
      border-radius: 8px;
      background: var(--r-raised);
      box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
    }
    p {
      flex: 1;
      margin: 4px 0;
      max-height: 160px;
      overflow-y: auto;
      font: 12px/1.5 var(--r-mono);
      white-space: pre-wrap;
      user-select: text;
    }
  `,
  imports: [TPipe],
})
export class Toast {
  protected readonly repository = inject(RepositoryService);
}
