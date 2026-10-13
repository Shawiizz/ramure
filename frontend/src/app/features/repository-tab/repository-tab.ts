import { Component, DestroyRef, computed, effect, inject, input, untracked } from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PreferencesService } from '../../core/services/preferences.service';
import { RepositoryService } from '../../core/services/repository.service';
import { Tab, TabsService } from '../../core/services/tabs.service';
import { Toast } from '../../shell/toast/toast';
import { Details } from '../details/details';
import { DiffView } from '../diff/diff-view';
import { History } from '../history/history';
import { Sidebar } from '../sidebar/sidebar';
import { Toolbar } from '../toolbar/toolbar';
import { Welcome } from '../welcome/welcome';

/** One tab: its repository with everything shown of it, or the welcome page. */
@Component({
  selector: 'app-repository-tab',
  template: `
    @if (repository.snapshot()) {
      <app-toolbar />
      <div class="workspace">
        <app-sidebar />
        <!-- the history stays beneath an open diff: closing it shows it back at once -->
        <div class="center">
          <app-history />
          @if (repository.diff()) {
            <app-diff-view />
          }
        </div>
        <app-details />
      </div>
    } @else {
      <app-welcome (chose)="show($event)" />
    }
    <app-toast />
  `,
  styles: `
    :host {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    :host(.behind) {
      display: none;
    }
    app-welcome {
      flex: 1;
      min-height: 0;
    }
    .center {
      position: relative;
      min-width: 0;
      min-height: 0;
    }
    app-history {
      display: block;
      height: 100%;
    }
    app-diff-view {
      position: absolute;
      inset: 0;
      background: var(--r-void);
    }
    .workspace {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 228px minmax(0, 1fr) 340px;
    }
  `,
  providers: [RepositoryService],
  host: { '[class.behind]': '!active()' },
  imports: [Toolbar, Sidebar, History, DiffView, Details, Welcome, Toast],
})
export class RepositoryTab {
  readonly tab = input.required<Tab>();
  readonly active = input(false);
  protected readonly repository = inject(RepositoryService);
  private readonly tabs = inject(TabsService);
  private readonly path = computed(() => this.tab().path);

  constructor() {
    effect(() => this.repository.active.set(this.active()));
    effect(() => {
      const path = this.path();
      untracked(() => this.load(path));
    });
    // back in front, or back from an editor or a terminal: the repository may have changed
    effect(() => {
      if (this.active()) untracked(() => this.repository.refresh());
    });
    const preferences = inject(PreferencesService);
    // the settings' timer fetches the remotes, the tab in front or not
    effect((onCleanup) => {
      const minutes = preferences.preferences().autoFetchMinutes;
      if (!minutes) return;
      const timer = setInterval(() => this.repository.fetchQuietly(), minutes * 60_000);
      onCleanup(() => clearInterval(timer));
    });
    // a longer or shorter history once the settings change it (nothing to read at first)
    effect(() => {
      preferences.preferences().historyLimit;
      untracked(() => this.repository.refresh());
    });
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused && this.active()) this.repository.refresh();
    });
    inject(DestroyRef).onDestroy(() => unlisten.then((stop) => stop()));
  }

  protected show(path: string) {
    this.tabs.show(this.tab().id, path);
  }

  /**
   * Opens what the tab names, under the repository's own path (a folder inside it names
   * it too); a folder outside any repository brings the welcome page back, saying why.
   */
  private async load(path: string | null) {
    if (!path) {
      this.repository.close();
      return;
    }
    if (path === this.repository.snapshot()?.path) return;
    if (!(await this.repository.open(path))) {
      this.tabs.show(this.tab().id, null);
      return;
    }
    const root = this.repository.snapshot()!.path;
    this.tabs.remember(root);
    if (root !== path) this.tabs.show(this.tab().id, root);
  }
}
