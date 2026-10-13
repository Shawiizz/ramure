import { Component, computed, inject } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Operation } from '../../core/models/repository';
import { PreferencesService } from '../../core/services/preferences.service';
import { RepositoryService, WIP } from '../../core/services/repository.service';
import { UpdateService } from '../../core/services/update.service';

/**
 * The strip along the window's bottom: the tab's branch and how far it is from its
 * upstream, its changes, what git is doing; the zoom, Ramure's version and its update.
 */
@Component({
  selector: 'app-status-bar',
  templateUrl: './status-bar.html',
  styleUrl: './status-bar.scss',
  imports: [TPipe],
})
export class StatusBar {
  protected readonly repository = inject(RepositoryService);
  protected readonly preferences = inject(PreferencesService);
  protected readonly update = inject(UpdateService);
  protected readonly zoom = computed(() => Math.round(this.preferences.preferences().zoom * 100));
  protected readonly upstream = computed(() => this.repository.snapshot()?.status.upstream ?? null);

  protected readonly head = computed(() => {
    const head = this.repository.snapshot()?.head;
    if (!head) return null;
    return head.kind === 'detached' ? head.id.slice(0, 7) : head.name;
  });

  protected readonly operation = computed(() => {
    const names: Record<Operation, string> = {
      rebase: t('Rebase under way'),
      cherryPick: t('Cherry-pick under way'),
      revert: t('Revert under way'),
      merge: t('Merge under way'),
    };
    const operation = this.repository.snapshot()?.operation;
    return operation ? names[operation] : null;
  });

  /** What git is busy with, if anything. */
  protected readonly busy = computed(() => {
    const exchange = this.repository.exchange();
    if (exchange === 'fetch') return t('Fetching…');
    if (exchange === 'pull') return t('Pulling…');
    if (exchange === 'push') return t('Pushing…');
    return this.repository.working() ? t('Working…') : null;
  });

  /** Brings the upstream's commits here, else sends this branch's there, else looks for new ones. */
  protected sync() {
    const upstream = this.upstream();
    const kind = upstream?.behind ? 'pull' : upstream?.ahead ? 'push' : 'fetch';
    void this.repository.exchangeWith(kind);
  }

  protected showChanges() {
    this.repository.select(WIP);
  }

  protected percent(share: number): number {
    return Math.round(share * 100);
  }
}
