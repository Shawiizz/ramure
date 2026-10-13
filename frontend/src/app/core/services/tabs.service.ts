import { Injectable, computed, inject, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { SettingsService } from './settings.service';

/** A tab: a repository, or the welcome page until one is chosen. */
export interface Tab {
  id: string;
  path: string | null;
}

const RECENT_MAX = 10;

/** The repository a window opened for a tab dragged out of another shows first. */
declare global {
  interface Window {
    __RAMURE_TAB__?: string;
  }
}

/**
 * The open tabs, the repositories opened lately, and the workspaces that reopen tabs
 * together. The first window's tabs are the ones kept from run to run; a window opened for a
 * tab dragged out starts with that one alone.
 */
@Injectable({ providedIn: 'root' })
export class TabsService {
  private readonly store = inject(SettingsService);
  private readonly window = getCurrentWebviewWindow();
  readonly main = this.window.label === 'main';
  readonly tabs = signal<Tab[]>([]);
  readonly activeId = signal('');
  readonly recent = computed(() => this.store.settings().recent);
  readonly workspaces = computed(() => this.store.settings().workspaces);
  /** The workspace whose tabs were opened, or kept, last. */
  readonly workspace = computed(() => {
    const { workspaces, workspaceId } = this.store.settings();
    return workspaces.find((w) => w.id === workspaceId) ?? null;
  });
  /** The repositories open in tabs. */
  readonly paths = computed(() => this.tabs().flatMap((tab) => (tab.path ? [tab.path] : [])));

  /** The tabs the last run left open, unless the settings say to start afresh. */
  restore() {
    // a tab dropped here from another window
    void this.window.listen<string>('adopt-tab', ({ payload }) => this.add(payload));
    const dragged = window.__RAMURE_TAB__;
    if (dragged) {
      const tab = newTab(dragged);
      this.tabs.set([tab]);
      this.activeId.set(tab.id);
      return;
    }
    const { tabs, activeTab, preferences } = this.store.settings();
    const restored = preferences.reopenTabs ? tabs.map(newTab) : [];
    this.tabs.set(restored.length ? restored : [newTab(null)]);
    this.activeId.set((restored[activeTab] ?? this.tabs()[0]).id);
  }

  /** A new tab, or the one already showing `path`, brought to the front. */
  add(path: string | null = null) {
    const open = path && this.tabs().find((tab) => tab.path === path);
    if (open) {
      this.activate(open.id);
      return;
    }
    const tab = newTab(path);
    this.tabs.update((tabs) => [...tabs, tab]);
    this.activate(tab.id);
  }

  /** Shows `path` in the tab `id`, or brings forward the tab already showing it. */
  show(id: string, path: string | null) {
    const open = path && this.tabs().find((tab) => tab.path === path && tab.id !== id);
    if (open) {
      this.activate(open.id);
      this.close(id);
      return;
    }
    this.tabs.update((tabs) => tabs.map((tab) => (tab.id === id ? { ...tab, path } : tab)));
    this.persist();
  }

  /** Moves the tab `id` to the place `index` among the tabs. */
  move(id: string, index: number) {
    const tabs = this.tabs();
    const tab = tabs.find((t) => t.id === id);
    if (!tab || tabs.indexOf(tab) === index) return;
    const rest = tabs.filter((t) => t !== tab);
    this.tabs.set([...rest.slice(0, index), tab, ...rest.slice(index)]);
    this.persist();
  }

  /** The tab `id` in a window of its own, its top left corner at the screen point given. */
  async detach(id: string, x: number, y: number): Promise<void> {
    const path = this.tabs().find((tab) => tab.id === id)?.path;
    if (!path) return;
    await invoke('open_window', { path, x: Math.round(x), y: Math.round(y) });
    this.release(id);
  }

  /** The tab `id` moved to the window `to`. */
  async give(id: string, to: string): Promise<void> {
    const path = this.tabs().find((tab) => tab.id === id)?.path;
    if (!path) return;
    await invoke('give_tab', { to, path });
    this.release(id);
  }

  /** The window whose title bar holds the screen point given, in physical pixels. */
  windowUnder(x: number, y: number): Promise<string | null> {
    return invoke<string | null>('window_under', { from: this.window.label, x, y });
  }

  /** A tab gone to another window: a window other than the first closes with its last. */
  private release(id: string) {
    if (!this.main && this.tabs().length === 1) void this.window.close();
    else this.close(id);
  }

  activate(id: string) {
    this.activeId.set(id);
    this.persist();
  }

  /** The tab `offset` places after the active one, going round. */
  cycle(offset: number) {
    const tabs = this.tabs();
    const i = tabs.findIndex((tab) => tab.id === this.activeId());
    this.activate(tabs[(i + offset + tabs.length) % tabs.length].id);
  }

  /** Closes a tab; the one beside it comes forward, and a welcome tab when none is left. */
  close(id: string) {
    const tabs = this.tabs();
    const i = tabs.findIndex((tab) => tab.id === id);
    if (i < 0) return;
    const rest = tabs.filter((tab) => tab.id !== id);
    if (!rest.length) rest.push(newTab(null));
    this.tabs.set(rest);
    if (!rest.some((tab) => tab.id === this.activeId())) {
      this.activeId.set(rest[Math.min(i, rest.length - 1)].id);
    }
    this.persist();
  }

  /** A repository opened: first in the recent ones. */
  remember(path: string) {
    this.store.update((s) => ({
      ...s,
      recent: [path, ...s.recent.filter((p) => p !== path)].slice(0, RECENT_MAX),
    }));
  }

  forget(path: string) {
    this.store.update((s) => ({ ...s, recent: s.recent.filter((p) => p !== path) }));
  }

  /** The repositories open now, kept under `name`: the workspace in use from then on. */
  saveWorkspace(name: string) {
    const workspace = { id: crypto.randomUUID(), name, paths: this.paths() };
    this.store.update((s) => ({
      ...s,
      workspaces: [...s.workspaces, workspace],
      workspaceId: workspace.id,
    }));
  }

  /** The workspace `id` holds the repositories open now instead. */
  updateWorkspace(id: string) {
    const paths = this.paths();
    this.store.update((s) => ({
      ...s,
      workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, paths } : w)),
    }));
  }

  /** Switches to a workspace: its repositories in the tabs, in place of the others. */
  openWorkspace(id: string) {
    const workspace = this.workspaces().find((w) => w.id === id);
    if (!workspace?.paths.length) return;
    const tabs = workspace.paths.map(
      (path) => this.tabs().find((tab) => tab.path === path) ?? newTab(path),
    );
    this.tabs.set(tabs);
    this.store.update((s) => ({ ...s, workspaceId: id }));
    this.activate(tabs[0].id);
  }

  removeWorkspace(id: string) {
    this.store.update((s) => ({
      ...s,
      workspaces: s.workspaces.filter((w) => w.id !== id),
      workspaceId: s.workspaceId === id ? null : s.workspaceId,
    }));
  }

  private persist() {
    if (!this.main) return;
    const paths = this.paths();
    const active = this.tabs().find((tab) => tab.id === this.activeId())?.path;
    this.store.update((s) => ({
      ...s,
      tabs: paths,
      activeTab: active ? paths.indexOf(active) : 0,
    }));
  }
}

function newTab(path: string | null): Tab {
  return { id: crypto.randomUUID(), path };
}

/** The last folder of a path, and the folder holding it. */
export function splitPath(path: string): { name: string; parent: string } {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return { name: path.slice(cut + 1), parent: path.slice(0, Math.max(cut, 0)) };
}
