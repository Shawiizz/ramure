import { Pipe, PipeTransform } from '@angular/core';
import { Params, t } from './i18n';

/**
 * `'Text' | t` or `'{n} commits' | t: { n: 3 }`, in the UI's language. Not pure: the same
 * text reads differently once the language changes.
 */
@Pipe({ name: 't', pure: false })
export class TPipe implements PipeTransform {
  transform(text: string, params?: Params): string {
    return t(text, params);
  }
}
