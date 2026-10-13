import { Component, inject } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService } from '../../core/services/repository.service';

/** Before a repository is open: open one, or one of the last ones. */
@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.html',
  styleUrl: './welcome.scss',
  imports: [TPipe],
})
export class Welcome {
  protected readonly repository = inject(RepositoryService);

  /** The folder's name, and where it is. */
  split(path: string): { name: string; parent: string } {
    const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
    return { name: path.slice(cut + 1), parent: path.slice(0, cut) };
  }
}
