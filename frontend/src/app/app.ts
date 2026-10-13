import { Component, HostListener, inject } from '@angular/core';
import { PreferencesService } from './core/services/preferences.service';
import { TabsService } from './core/services/tabs.service';
import { RepositoryTab } from './features/repository-tab/repository-tab';
import { SettingsDialog } from './shell/settings-dialog/settings-dialog';
import { Titlebar } from './shell/titlebar/titlebar';

@Component({
  selector: 'app-root',
  template: `
    <app-titlebar />
    <main>
      @for (tab of tabs.tabs(); track tab.id) {
        <app-repository-tab [tab]="tab" [active]="tab.id === tabs.activeId()" />
      }
    </main>
    @if (preferences.open()) {
      <app-settings-dialog />
    }
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
  imports: [Titlebar, RepositoryTab, SettingsDialog],
})
export class App {
  protected readonly tabs = inject(TabsService);
  protected readonly preferences = inject(PreferencesService);

  @HostListener('document:keydown', ['$event'])
  protected shortcut(event: KeyboardEvent) {
    if (!event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === ',') this.preferences.open.set(!this.preferences.open());
    else if (key === 't') this.tabs.add();
    else if (key === 'w') this.tabs.close(this.tabs.activeId());
    else if (key === 'tab') this.tabs.cycle(event.shiftKey ? -1 : 1);
    else return;
    event.preventDefault();
  }
}
