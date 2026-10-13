import { Component, computed, inject } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Branch } from '../../core/models/repository';
import { RepositoryService } from '../../core/services/repository.service';

interface Section {
  title: string;
  kind: 'local' | 'remote' | 'tag';
  items: Branch[];
}

/**
 * The branches, remote branches and tags: a click shows their commit, a double click on a
 * branch switches to it.
 */
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
      { title: t('Branches'), kind: 'local', items: s.branches },
      { title: t('Remote'), kind: 'remote', items: s.remoteBranches },
      { title: t('Tags'), kind: 'tag', items: s.tags },
    ];
  });
  protected readonly switchHint = t('Double-click to switch to it');

  protected switchTo(section: Section, item: Branch) {
    if (section.kind !== 'tag' && !(section.kind === 'local' && item.name === this.head())) {
      this.repository.checkout(item.name, section.kind === 'remote');
    }
  }
}
