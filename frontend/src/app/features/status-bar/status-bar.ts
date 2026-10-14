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

  /** What git is busy with, if anything, as its command is called. */
  protected readonly busy = computed(() => {
    const activity = this.repository.exchange() ?? this.repository.activity();
    if (this.repository.loading()) return t('Opening…');
    if (!activity) return null;
    return ACTIVITIES[activity]?.() ?? t('Working…');
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

/** The loader's words for the commands that take a while. */
const ACTIVITIES: Record<string, () => string> = {
  fetch: () => t('Fetching…'),
  fetch_remote: () => t('Fetching…'),
  pull: () => t('Pulling…'),
  push: () => t('Pushing…'),
  push_branch: () => t('Pushing…'),
  push_tag: () => t('Pushing…'),
  checkout: () => t('Switching…'),
  checkout_commit: () => t('Switching…'),
  checkout_pull: () => t('Switching…'),
  commit: () => t('Committing…'),
  merge: () => t('Merging…'),
  rebase: () => t('Rebasing…'),
  rebase_branch: () => t('Rebasing…'),
  rebase_interactive: () => t('Rebasing…'),
  rewrite: () => t('Rewriting…'),
  cherry_pick: () => t('Cherry-picking…'),
  revert: () => t('Reverting…'),
  reset: () => t('Resetting…'),
  stash: () => t('Stashing…'),
  stash_pop: () => t('Bringing the stash back…'),
  stash_apply: () => t('Bringing the stash back…'),
  discard: () => t('Discarding…'),
  discard_all: () => t('Discarding…'),
  read_more: () => t('Reading older commits…'),
};
