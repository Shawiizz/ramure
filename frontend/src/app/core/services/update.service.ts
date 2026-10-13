import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';

/** Where Ramure's releases are published. */
const RELEASES = 'https://api.github.com/repos/Shawiizz/ramure/releases/latest';
/** How often a newer release is looked for, while Ramure runs. */
const EVERY = 6 * 60 * 60 * 1000;

/** A release newer than the one running. */
export interface Release {
  version: string;
  url: string;
}

/** `a` comes after `b`: versions compared number by number, a pre-release before its release. */
export function newer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, '').split('-', 2);
    return { numbers: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.numbers.length, y.numbers.length); i++) {
    const d = (x.numbers[i] ?? 0) - (y.numbers[i] ?? 0);
    if (d) return d > 0;
  }
  if (x.pre === y.pre) return false;
  if (x.pre === null) return true;
  if (y.pre === null) return false;
  return x.pre > y.pre;
}

/** The version running, and a newer release once one is published. */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  readonly version = signal('');
  readonly available = signal<Release | null>(null);

  constructor() {
    void this.check();
    const timer = setInterval(() => this.check(), EVERY);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Looks for a newer release; offline, or with none published, nothing is shown. */
  async check(): Promise<void> {
    try {
      const running = this.version() || (await getVersion());
      this.version.set(running);
      const answer = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } });
      if (!answer.ok) return;
      const release = (await answer.json()) as { tag_name?: unknown; html_url?: unknown };
      const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
      const url = typeof release.html_url === 'string' ? release.html_url : '';
      this.available.set(
        tag && url && newer(tag, running) ? { version: tag.replace(/^v/, ''), url } : null,
      );
    } catch (e) {
      console.warn('no release information', e);
    }
  }
}
