import { Component, computed, inject } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Operation } from '../../core/models/repository';
import { RepositoryService } from '../../core/services/repository.service';

/**
 * What git stopped in the middle of (a rebase, a cherry-pick, a revert, a merge), waiting
 * for its conflicts: give it up, or go on once they are resolved.
 */
@Component({
  selector: 'app-operation-banner',
  template: `
    @if (operation(); as operation) {
      <div class="banner" role="status">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2l6.5 11.5h-13z" />
          <path d="M8 6.5v3.2M8 11.6h.01" />
        </svg>
        <p>
          <b>{{ what() }}</b>
          {{
            conflicts() === 0
              ? ('Nothing left in conflict: go on when ready.' | t)
              : conflicts() === 1
                ? ('Resolve the conflict, stage it, then go on.' | t)
                : ('Resolve the {n} conflicts, stage them, then go on.' | t: { n: conflicts() })
          }}
        </p>
        <button
          class="r-btn r-btn--ghost"
          [disabled]="repository.working()"
          (click)="repository.abortOperation()"
        >
          {{ 'Abort' | t }}
        </button>
        <button
          class="r-btn r-btn--primary"
          [disabled]="repository.working() || conflicts() > 0"
          (click)="repository.proceedOperation()"
        >
          {{ 'Continue' | t }}
        </button>
      </div>
    }
  `,
  styles: `
    .banner {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px 8px 16px;
      border-bottom: 1px solid color-mix(in srgb, var(--r-lane-1) 40%, transparent);
      background: color-mix(in srgb, var(--r-lane-1) 12%, var(--r-base));
    }
    svg {
      flex: none;
      width: 18px;
      height: 18px;
      fill: none;
      stroke: var(--r-lane-1);
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    p {
      flex: 1;
      margin: 0;
      color: var(--r-text-2);
      b {
        margin-right: 6px;
        color: var(--r-text);
        font-weight: 600;
      }
    }
  `,
  imports: [TPipe],
})
export class OperationBanner {
  protected readonly repository = inject(RepositoryService);
  protected readonly operation = computed(() => this.repository.snapshot()?.operation ?? null);
  protected readonly conflicts = computed(
    () => this.repository.snapshot()?.status.conflicted.length ?? 0,
  );
  protected readonly what = computed(() => {
    const names: Record<Operation, string> = {
      rebase: t('A rebase is under way.'),
      cherryPick: t('A cherry-pick is under way.'),
      revert: t('A revert is under way.'),
      merge: t('A merge is under way.'),
    };
    const operation = this.operation();
    return operation ? names[operation] : '';
  });
}
