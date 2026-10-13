import { Injectable, computed, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '../i18n/i18n';
import { Commit, RefLabel, Snapshot } from '../models/repository';

const RECENT_KEY = 'ramure.recent';
const RECENT_MAX = 8;

/** The open repository, the selected commit, and the repositories opened lately. */
@Injectable({ providedIn: 'root' })
export class RepositoryService {
  readonly snapshot = signal<Snapshot | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly selectedId = signal<string | null>(null);
  readonly recent = signal<string[]>(readRecent());

  readonly selected = computed<Commit | null>(() => {
    const id = this.selectedId();
    return this.snapshot()?.commits.find((c) => c.id === id) ?? null;
  });

  /** The branch and tag names pointing at each commit. */
  readonly labels = computed(() => {
    const snapshot = this.snapshot();
    const labels = new Map<string, RefLabel[]>();
    if (!snapshot) return labels;
    const head = snapshot.head.kind === 'branch' ? snapshot.head.name : null;
    const add = (target: string, label: RefLabel) =>
      labels.set(target, [...(labels.get(target) ?? []), label]);
    for (const b of snapshot.branches)
      add(b.target, { name: b.name, kind: 'branch', head: b.name === head });
    for (const b of snapshot.remoteBranches)
      add(b.target, { name: b.name, kind: 'remote', head: false });
    for (const b of snapshot.tags) add(b.target, { name: b.name, kind: 'tag', head: false });
    return labels;
  });

  /** Asks for a folder and opens the repository holding it. */
  async pick(): Promise<void> {
    const path = await open({ directory: true, title: t('Open a repository') });
    if (typeof path === 'string') await this.open(path);
  }

  async open(path: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const snapshot = await invoke<Snapshot>('open_repository', { path });
      this.snapshot.set(snapshot);
      this.selectedId.set(snapshot.commits[0]?.id ?? null);
      this.remember(snapshot.path);
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }

  close() {
    this.snapshot.set(null);
    this.selectedId.set(null);
  }

  forget(path: string) {
    this.saveRecent(this.recent().filter((p) => p !== path));
  }

  private remember(path: string) {
    this.saveRecent([path, ...this.recent().filter((p) => p !== path)].slice(0, RECENT_MAX));
  }

  private saveRecent(paths: string[]) {
    this.recent.set(paths);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(paths));
    } catch {
      // storage unavailable: the list lasts for this run
    }
  }
}

function readRecent(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}
