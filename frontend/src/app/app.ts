import { Component, inject } from '@angular/core';
import { RepositoryService } from './core/services/repository.service';
import { Details } from './features/details/details';
import { History } from './features/history/history';
import { Sidebar } from './features/sidebar/sidebar';
import { Welcome } from './features/welcome/welcome';
import { Titlebar } from './shell/titlebar/titlebar';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  imports: [Titlebar, Welcome, Sidebar, History, Details],
})
export class App {
  protected readonly repository = inject(RepositoryService);
}
