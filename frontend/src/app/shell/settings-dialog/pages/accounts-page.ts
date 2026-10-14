import { Component, inject, signal } from '@angular/core';
import { TPipe } from '../../../core/i18n/t.pipe';
import { GithubService } from '../../../core/services/github.service';

/**
 * The hosting services Ramure is signed in to. GitHub: signed in with a code typed on its
 * site, the token kept by the system's credential manager.
 */
@Component({
  selector: 'app-accounts-page',
  template: `
    <div class="service">
      <svg class="mark" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
        />
      </svg>
      <div class="about">
        <span class="name">GitHub</span>
        @if (github.account(); as account) {
          <span class="who">
            <img [src]="account.avatar_url" alt="" />
            {{ account.name || account.login }} · @{{ account.login }}
          </span>
        } @else {
          <span class="help">{{
            'Clone your repositories, see and open pull requests, add your ssh key.' | t
          }}</span>
        }
      </div>
      @if (github.account()) {
        <button class="r-btn small" (click)="github.signOut()">{{ 'Sign out' | t }}</button>
      } @else if (!github.signingIn()) {
        <button class="r-btn r-btn--primary small" (click)="github.signIn()">
          {{ 'Sign in' | t }}
        </button>
      }
    </div>
    @if (github.signingIn(); as signing) {
      <div class="code">
        <p>{{ 'Type this code on the page GitHub opened, then come back:' | t }}</p>
        <div class="line">
          <code class="r-mono selectable">{{ signing.code }}</code>
          <button class="r-btn small" (click)="copy(signing.code)">
            {{ copied() ? ('Copied' | t) : ('Copy' | t) }}
          </button>
        </div>
        <p class="waiting">
          {{ 'Waiting for GitHub…' | t }}
          <button class="link" (click)="open(signing.uri)">{{ signing.uri }}</button>
        </p>
        <button class="r-btn r-btn--ghost small" (click)="github.cancel()">
          {{ 'Cancel' | t }}
        </button>
      </div>
    }
    @if (github.failure(); as failure) {
      <p class="failure">{{ failure }}</p>
    }
  `,
  styleUrl: '../rows.scss',
  styles: `
    .service {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px 0;
      border-bottom: 1px solid var(--r-line);
    }
    .mark {
      flex: none;
      width: 28px;
      height: 28px;
      fill: var(--r-text);
    }
    .about {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .who {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--r-text-2);
      img {
        width: 18px;
        height: 18px;
        border-radius: 50%;
      }
    }
    .small {
      height: 30px;
      padding: 0 14px;
      font-size: 12px;
    }
    .code {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      margin-top: 14px;
      padding: 14px 16px;
      border-radius: var(--r-radius);
      background: var(--r-void);
      p {
        margin: 0;
        color: var(--r-text-2);
      }
    }
    .line {
      display: flex;
      align-items: center;
      gap: 10px;
      code {
        font-size: 22px;
        font-weight: 600;
        letter-spacing: 0.12em;
      }
    }
    .code .waiting {
      color: var(--r-text-3);
      font-size: 12px;
    }
    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--r-accent);
      font: inherit;
      cursor: pointer;
    }
  `,
  imports: [TPipe],
})
export class AccountsPage {
  protected readonly github = inject(GithubService);
  protected readonly copied = signal(false);

  protected copy(code: string) {
    void navigator.clipboard.writeText(code);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }

  protected open(url: string) {
    void this.github.openPage(url);
  }
}
