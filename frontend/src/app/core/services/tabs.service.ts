import { Injectable, computed, inject, signal } from '@angular/core';
import { SettingsService } from './settings.service';

/** A tab: a repository, or the welcome page until one is chosen. */
export interface Tab {
  id: string;
  path: string | null;
}

const RECENT_MAX = 10;

/** The open tabs, the repositories opened lately, and the workspaces that reopen tabs together. */
@Injectable({ providedIn: 'root' })
export class TabsService {
  private readonly store = inject(SettingsService);
  readonly tabs = signal<Tab[]>([]);
  readonly activeId = signal('');
  readonly recent = computed(() => this.store.settings().recent);
  readonly workspaces = computed(() => this.store.settings().workspaces);
  /** The repositories open in tabs. */
  readonly paths = computed(() => this.tabs().flatMap((tab) => (tab.path ? [tab.path] : [])));

  /** The tabs the last run left open, unless the settings say to start afresh. */
  restore() {
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

  /** The repositories open now, kept under `name`. */
  saveWorkspace(name: string) {
    const workspace = { id: crypto.randomUUID(), name, paths: this.paths() };
    this.store.update((s) => ({ ...s, workspaces: [...s.workspaces, workspace] }));
  }

  /** Opens a workspace's repositories in tabs (welcome tabs make way), its first in front. */
  openWorkspace(id: string) {
    const workspace = this.workspaces().find((w) => w.id === id);
    if (!workspace?.paths.length) return;
    const kept = this.tabs().filter((tab) => tab.path);
    const added = workspace.paths.filter((path) => !kept.some((tab) => tab.path === path));
    const tabs = [...kept, ...added.map(newTab)];
    this.tabs.set(tabs);
    this.activate(tabs.find((tab) => tab.path === workspace.paths[0])!.id);
  }

  removeWorkspace(id: string) {
    this.store.update((s) => ({ ...s, workspaces: s.workspaces.filter((w) => w.id !== id) }));
  }

  private persist() {
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
