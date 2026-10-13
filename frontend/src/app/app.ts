import { Component, inject } from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { RepositoryService } from './core/services/repository.service';
import { Details } from './features/details/details';
import { DiffView } from './features/diff/diff-view';
import { History } from './features/history/history';
import { Sidebar } from './features/sidebar/sidebar';
import { Welcome } from './features/welcome/welcome';
import { Titlebar } from './shell/titlebar/titlebar';
import { Toast } from './shell/toast/toast';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  imports: [Titlebar, Welcome, Sidebar, History, DiffView, Details, Toast],
})
export class App {
  protected readonly repository = inject(RepositoryService);

  constructor() {
    // back from an editor or a terminal: the repository may have changed meanwhile
    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) this.repository.refresh();
    });
  }
}
