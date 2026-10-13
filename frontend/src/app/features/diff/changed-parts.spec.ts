import { DiffLine, Hunk } from '../../core/models/repository';
import { markChanges } from './changed-parts';

const line = (kind: DiffLine['kind'], text: string): DiffLine => ({
  kind,
  old: null,
  new: null,
  text,
});

const marks = (hunk: Hunk) =>
  markChanges(hunk).map((l) => l.parts.map((p) => (p.changed ? `[${p.text}]` : p.text)).join(''));

describe('changed parts', () => {
  it('mark the word that changed in a line and its replacement', () => {
    const hunk = {
      header: '',
      lines: [
        line('context', '#Deck {'),
        line('removed', '  border-top: 2px solid #2fd6ff;'),
        line('added', '  border-top: 1px solid #2fd6ff;'),
        line('context', '}'),
      ],
    };
    expect(marks(hunk)).toEqual([
      '#Deck {',
      '  border-top: [2px] solid #2fd6ff;',
      '  border-top: [1px] solid #2fd6ff;',
      '}',
    ]);
  });

  it('pair the lines of a block in order, and leave the lines left over alone', () => {
    const hunk = {
      header: '',
      lines: [
        line('removed', 'let speed = 10;'),
        line('removed', 'let pitch = 0.5;'),
        line('added', 'let speed = 20;'),
      ],
    };
    expect(marks(hunk)).toEqual(['let speed = [10];', 'let pitch = 0.5;', 'let speed = [20];']);
  });

  it('mark nothing in a line that changed all through', () => {
    const hunk = {
      header: '',
      lines: [line('removed', 'background: red;'), line('added', 'return value * 2;')],
    };
    expect(marks(hunk)).toEqual(['background: red;', 'return value * 2;']);
  });
});
