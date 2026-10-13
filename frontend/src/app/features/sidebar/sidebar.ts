import { Component, computed, inject } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Branch } from '../../core/models/repository';
import { RepositoryService } from '../../core/services/repository.service';

interface Section {
  title: string;
  /** Local branches: the one checked out is marked. */
  local: boolean;
  items: Branch[];
}

/** The branches, remote branches and tags: a click shows their commit. */
@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
  imports: [TPipe],
})
export class Sidebar {
  protected readonly repository = inject(RepositoryService);
  protected readonly head = computed(() => {
    const head = this.repository.snapshot()?.head;
    return head?.kind === 'branch' ? head.name : null;
  });
  protected readonly sections = computed<Section[]>(() => {
    const s = this.repository.snapshot();
    if (!s) return [];
    return [
      { title: t('Branches'), local: true, items: s.branches },
      { title: t('Remote'), local: false, items: s.remoteBranches },
      { title: t('Tags'), local: false, items: s.tags },
    ];
  });
}
