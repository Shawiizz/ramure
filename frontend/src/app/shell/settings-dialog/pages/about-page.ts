import { Component, signal } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { TPipe } from '../../../core/i18n/t.pipe';

/** Ramure's version, git's, the licence and where the code is. */
@Component({
  selector: 'app-about-page',
  template: `
    <div class="about">
      <img src="logo.svg" alt="" />
      <div>
        <p class="title">
          ramure <span class="r-mono">{{ version() }}</span>
        </p>
        <p>{{ 'A free and open source Git client.' | t }}</p>
      </div>
    </div>
    <div class="row">
      <span class="name">Git</span>
      <span class="value r-mono">{{ gitVersion() ?? ('git could not be found' | t) }}</span>
    </div>
    <div class="row">
      <span class="name">{{ 'License' | t }}</span>
      <span class="value r-mono">GPL-3.0-or-later</span>
    </div>
    <div class="row">
      <span class="name">{{ 'Source code' | t }}</span>
      <span class="value r-mono selectable">github.com/Shawiizz/ramure</span>
    </div>
  `,
  styleUrls: ['../rows.scss', './about-page.scss'],
  imports: [TPipe],
})
export class AboutPage {
  protected readonly version = signal('');
  /** git's version once it answers, null when it cannot be found. */
  protected readonly gitVersion = signal<string | null>('');

  constructor() {
    getVersion().then((v) => this.version.set(v));
    invoke<string>('git_version').then(
      (v) => this.gitVersion.set(v),
      () => this.gitVersion.set(null),
    );
  }
}
