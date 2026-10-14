import { Component, HostListener, afterNextRender, inject } from '@angular/core';
import { PreferencesService } from './core/services/preferences.service';
import { TabsService } from './core/services/tabs.service';
import { RepositoryTab } from './features/repository-tab/repository-tab';
import { SettingsDialog } from './shell/settings-dialog/settings-dialog';
import { NewRepositoryService } from './core/services/new-repository.service';
import { CloneDialog } from './shell/new-repository/clone-dialog';
import { CreateDialog } from './shell/new-repository/create-dialog';
import { Titlebar } from './shell/titlebar/titlebar';
import { Tooltip } from './shell/tooltip/tooltip';
import { warmMonaco } from './shared/monaco';

@Component({
  selector: 'app-root',
  template: `
    <app-titlebar />
    <main>
      @for (tab of tabs.tabs(); track tab.id) {
        <app-repository-tab [tab]="tab" [active]="tab.id === tabs.activeId()" />
      }
    </main>
    @switch (making.making()) {
      @case ('clone') {
        @defer {
          <app-clone-dialog />
        }
      }
      @case ('create') {
        @defer {
          <app-create-dialog />
        }
      }
    }
    <!-- loaded the first time the settings open -->
    @if (preferences.open()) {
      @defer {
        <app-settings-dialog />
      }
    }
    <app-tooltip />
  `,
  styles: `
    :host {
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    main {
      flex: 1;
      min-height: 0;
    }
  `,
  imports: [Titlebar, RepositoryTab, SettingsDialog, Tooltip, CloneDialog, CreateDialog],
})
export class App {
  constructor() {
    // the editor the diffs are shown in, made ready while nothing else is going on
    afterNextRender(() => requestIdleCallback(() => warmMonaco()));
    // Ctrl and the wheel zoom, as in a browser
    document.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey || !event.deltaY) return;
        event.preventDefault();
        this.preferences.zoom(event.deltaY < 0 ? 1 : -1);
      },
      { passive: false },
    );
  }

  protected readonly tabs = inject(TabsService);
  protected readonly making = inject(NewRepositoryService);
  protected readonly preferences = inject(PreferencesService);

  @HostListener('document:keydown', ['$event'])
  protected shortcut(event: KeyboardEvent) {
    if (!event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === '+' || key === '=' || event.code === 'NumpadAdd') this.preferences.zoom(1);
    else if (key === '-' || event.code === 'NumpadSubtract') this.preferences.zoom(-1);
    else if (event.code === 'Digit0' || event.code === 'Numpad0') this.preferences.zoom(0);
    else if (key === ',') this.preferences.open.set(!this.preferences.open());
    else if (key === 't') this.tabs.add();
    else if (key === 'w') this.tabs.close(this.tabs.activeId());
    else if (key === 'tab') this.tabs.cycle(event.shiftKey ? -1 : 1);
    else return;
    event.preventDefault();
  }
}
