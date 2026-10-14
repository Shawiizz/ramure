import { Component, computed, inject, input } from '@angular/core';
import { t } from '../core/i18n/i18n';
import { Check, CheckState } from '../core/models/github';
import { RepositoryService } from '../core/services/repository.service';

/** Where checks stand together: failed if one did, running while one is, else passed. */
export function overall(checks: Check[]): CheckState {
  const states = new Set(checks.map((c) => c.state));
  if (states.has('failure')) return 'failure';
  if (states.has('pending')) return 'pending';
  return states.has('success') ? 'success' : 'neutral';
}

/** How a check's state reads, for its tooltip and its list. */
export function stateName(state: CheckState): string {
  const names: Record<CheckState, () => string> = {
    success: () => t('Passed'),
    failure: () => t('Failed'),
    pending: () => t('Running'),
    neutral: () => t('Skipped'),
  };
  return names[state]();
}

/** A commit's checks on GitHub in a glance: a tick, a cross, or a dot while they run. */
@Component({
  selector: 'app-checks-mark',
  template: `
    @if (state(); as state) {
      <svg [class]="state" viewBox="0 0 16 16" role="img" [attr.aria-label]="summary()">
        <title>{{ summary() }}</title>
        @switch (state) {
          @case ('success') {
            <path d="M3.5 8.5l3 3 6-7" />
          }
          @case ('failure') {
            <path d="M4 4l8 8M12 4l-8 8" />
          }
          @case ('pending') {
            <circle cx="8" cy="8" r="3" />
          }
          @default {
            <path d="M4 8h8" />
          }
        }
      </svg>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .success {
      stroke: rgb(var(--r-added-rgb));
    }
    .failure {
      stroke: rgb(var(--r-removed-rgb));
    }
    .pending {
      stroke: var(--r-lane-1);
      fill: var(--r-lane-1);
    }
    .neutral {
      stroke: var(--r-text-3);
    }
  `,
})
export class ChecksMark {
  private readonly repository = inject(RepositoryService);
  readonly id = input.required<string>();
  private readonly checks = computed(() => this.repository.checks().get(this.id()) ?? null);
  protected readonly state = computed(() => {
    const checks = this.checks();
    return checks ? overall(checks) : null;
  });
  protected readonly summary = computed(() =>
    (this.checks() ?? []).map((c) => `${stateName(c.state)} · ${c.name}`).join('\n'),
  );
}
