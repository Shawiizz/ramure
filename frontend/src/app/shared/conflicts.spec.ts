import { findConflicts, resolution } from './conflicts';

const FILE = [
  'start',
  '<<<<<<< HEAD',
  'ours',
  '=======',
  'theirs',
  'theirs too',
  '>>>>>>> feature',
  'middle',
  '<<<<<<< HEAD',
  'mine',
  '||||||| base',
  'old',
  '=======',
  '>>>>>>> 1a2b3c4 (Drop it)',
  'end',
];

describe('conflicts', () => {
  it('are found with their sides’ names, the common version too', () => {
    expect(findConflicts(FILE)).toEqual([
      { start: 2, base: null, middle: 4, end: 7, current: 'HEAD', incoming: 'feature' },
      { start: 9, base: 11, middle: 13, end: 14, current: 'HEAD', incoming: '1a2b3c4 (Drop it)' },
    ]);
  });

  it('leave markers that make no whole conflict alone', () => {
    expect(
      findConflicts(['=======', '<<<<<<< HEAD', 'a', '>>>>>>> x', '<<<<<<<< not one']),
    ).toEqual([]);
  });

  it('are resolved with a side, or both', () => {
    const [first, second] = findConflicts(FILE);
    expect(resolution(FILE, first, 'current')).toEqual(['ours']);
    expect(resolution(FILE, first, 'incoming')).toEqual(['theirs', 'theirs too']);
    expect(resolution(FILE, first, 'both')).toEqual(['ours', 'theirs', 'theirs too']);
    expect(resolution(FILE, second, 'current')).toEqual(['mine']);
    expect(resolution(FILE, second, 'incoming')).toEqual([]);
  });
});
