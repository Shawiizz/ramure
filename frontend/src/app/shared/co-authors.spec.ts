import { splitCoAuthors } from './co-authors';

describe('co-authors', () => {
  it('come out of the description, which keeps the rest', () => {
    const body = [
      'Align panels and buttons.',
      '',
      'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>',
      'co-authored-by: Ada Lovelace <ada@example.com>',
    ].join('\n');
    expect(splitCoAuthors(body)).toEqual({
      text: 'Align panels and buttons.',
      coAuthors: [
        { name: 'Claude Sonnet 5.5', email: 'noreply@anthropic.com' },
        { name: 'Ada Lovelace', email: 'ada@example.com' },
      ],
    });
  });

  it('are named once, and a description without any stays as it is', () => {
    const twice = 'Co-authored-by: Ada <ada@example.com>\nCo-authored-by: Ada <ADA@example.com>';
    expect(splitCoAuthors(twice).coAuthors).toEqual([{ name: 'Ada', email: 'ada@example.com' }]);
    expect(splitCoAuthors('Why it was done.')).toEqual({ text: 'Why it was done.', coAuthors: [] });
  });
});
