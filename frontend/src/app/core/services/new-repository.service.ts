import { Injectable, inject, signal } from '@angular/core';
import { TabsService } from './tabs.service';

/** How a repository comes to be: cloned from a remote, or made anew. */
export type Making = 'clone' | 'create';

/** The dialog making a repository, open over the window; the one made shows in the tab in front. */
@Injectable({ providedIn: 'root' })
export class NewRepositoryService {
  private readonly tabs = inject(TabsService);
  readonly making = signal<Making | null>(null);

  /** The repository made, shown in the tab in front. */
  made(path: string) {
    this.making.set(null);
    this.tabs.show(this.tabs.activeId(), path);
  }
}
