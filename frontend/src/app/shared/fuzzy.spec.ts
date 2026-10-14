import { fuzzy } from './fuzzy';

describe('fuzzy matching', () => {
  it('finds the letters typed in order, ignoring case and spaces', () => {
    expect(fuzzy('fch', 'Fetch')?.at).toEqual([0, 3, 4]);
    expect(fuzzy('re po', 'Open a repository')).not.toBeNull();
    expect(fuzzy('hcf', 'Fetch')).toBeNull();
  });

  it('prefers the starts of words and letters that follow each other', () => {
    expect(fuzzy('dv', 'src/diff-view.ts')?.at).toEqual([4, 9]);
    const words = fuzzy('rs', 'repository-service.ts')!.score;
    const scattered = fuzzy('rs', 'carpets')!.score;
    expect(words).toBeGreaterThan(scattered);
    expect(fuzzy('push', 'Push')!.score).toBeGreaterThan(fuzzy('push', 'Push the tag v1')!.score);
  });

  it('matches everything with nothing typed', () => {
    expect(fuzzy('', 'Anything')).toEqual({ score: 0, at: [] });
  });
});
