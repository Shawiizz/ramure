import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TPipe } from '../../core/i18n/t.pipe';
import { PreferencesService } from '../../core/services/preferences.service';
import { TabsService, splitPath } from '../../core/services/tabs.service';
import { ProfileMenu } from '../profile-menu/profile-menu';
import { WorkspaceMenu } from '../workspace-menu/workspace-menu';

/** How far a tab is pulled before it moves, and away from the strip before it leaves it. */
const PULL = 5;
const LEAVE = 36;
/** Where the tabs start in a window, from its left edge: a tab left there lands under the pointer. */
const STRIP_LEFT = 250;

/** A tab being pulled, and whether it has left the strip. */
interface Held {
  id: string;
  out: boolean;
}

/**
 * Custom title bar: the logo, the tabs, the workspaces, the settings, the profile, the
 * window buttons.
 */
@Component({
  selector: 'app-titlebar',
  templateUrl: './titlebar.html',
  styleUrl: './titlebar.scss',
  imports: [TPipe, WorkspaceMenu, ProfileMenu],
})
export class Titlebar {
  protected readonly tabs = inject(TabsService);
  protected readonly preferences = inject(PreferencesService);
  protected readonly split = splitPath;
  protected readonly held = signal<Held | null>(null);
  private readonly strip = viewChild.required<ElementRef<HTMLElement>>('strip');

  /**
   * A tab pressed comes forward; pulled, it follows the pointer and the others make way.
   * Let go away from the strip, it goes to the window whose tabs it is over, or to a
   * window of its own.
   */
  protected press(event: PointerEvent, id: string) {
    if (event.button !== 0) return;
    this.tabs.activate(id);
    const tab = event.currentTarget as HTMLElement;
    const from = { x: event.clientX, y: event.clientY };
    const start = tab.getBoundingClientRect().left;
    let shift = 0;
    tab.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (!this.held() && Math.hypot(dx, dy) < PULL) return;
      const out = Math.abs(dy) > LEAVE;
      this.held.set({ id, out });
      if (!out) this.reorder(id, e.clientX);
      // its place in the strip may have changed: the pointer keeps where it took it
      const place = tab.getBoundingClientRect().left - shift;
      shift = dx - (place - start);
      tab.style.transform = `translate(${shift}px, ${out ? dy : 0}px)`;
    };
    const end = (e: PointerEvent) => {
      tab.removeEventListener('pointermove', move);
      tab.removeEventListener('pointerup', end);
      tab.removeEventListener('pointercancel', end);
      tab.style.transform = '';
      const held = this.held();
      this.held.set(null);
      if (held?.out && e.type === 'pointerup') void this.drop(id, e);
    };
    tab.addEventListener('pointermove', move);
    tab.addEventListener('pointerup', end);
    tab.addEventListener('pointercancel', end);
  }

  /** The held tab's place: before the first other tab whose middle is past the pointer. */
  private reorder(id: string, x: number) {
    const others = [...this.strip().nativeElement.querySelectorAll<HTMLElement>('.tab')].filter(
      (tab) => tab.dataset['tab'] !== id,
    );
    const index = others.filter((tab) => {
      const box = tab.getBoundingClientRect();
      return box.left + box.width / 2 < x;
    }).length;
    this.tabs.move(id, index);
  }

  /** A tab let go away from the strip: over another window's tabs it joins them, else it gets its own. */
  private async drop(id: string, event: PointerEvent) {
    const scale = devicePixelRatio;
    const to = await this.tabs.windowUnder(event.screenX * scale, event.screenY * scale);
    if (to) await this.tabs.give(id, to);
    else if (this.tabs.tabs().length > 1)
      await this.tabs.detach(
        id,
        (event.screenX - STRIP_LEFT) * scale,
        (event.screenY - this.strip().nativeElement.offsetHeight / 2) * scale,
      );
  }

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
