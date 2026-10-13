import { Component, inject, output } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService } from '../../core/services/repository.service';
import { TabsService, splitPath } from '../../core/services/tabs.service';
import { pickRepository } from '../../shared/pick';

/** A tab without a repository yet: open one, one of the last ones, or a workspace. */
@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.html',
  styleUrl: './welcome.scss',
  imports: [TPipe],
})
export class Welcome {
  protected readonly repository = inject(RepositoryService);
  protected readonly tabs = inject(TabsService);
  protected readonly split = splitPath;
  readonly chose = output<string>();

  protected async pick() {
    const path = await pickRepository();
    if (path) this.chose.emit(path);
  }
}
