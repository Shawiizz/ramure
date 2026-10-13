import { Component, inject } from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TPipe } from '../../core/i18n/t.pipe';
import { TabsService, splitPath } from '../../core/services/tabs.service';
import { ProfileMenu } from '../profile-menu/profile-menu';
import { WorkspaceMenu } from '../workspace-menu/workspace-menu';

/** Custom title bar: the logo, the tabs, the workspaces, the profile, the window buttons. */
@Component({
  selector: 'app-titlebar',
  templateUrl: './titlebar.html',
  styleUrl: './titlebar.scss',
  imports: [TPipe, WorkspaceMenu, ProfileMenu],
})
export class Titlebar {
  protected readonly tabs = inject(TabsService);
  protected readonly split = splitPath;

  /** A middle click closes a tab, as in a browser. */
  protected auxClick(event: MouseEvent, id: string) {
    if (event.button !== 1) return;
    event.preventDefault();
    this.tabs.close(id);
  }

  protected minimize() {
    getCurrentWindow().minimize();
  }

  protected toggleMaximize() {
    getCurrentWindow().toggleMaximize();
  }

  protected close() {
    getCurrentWindow().close();
  }
}
