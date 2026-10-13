import { commitUrl } from './web-url';

describe('a commit on its website', () => {
  const id = 'abc123';

  it('is found from the remote in any of its forms', () => {
    const page = 'https://github.com/Shawiizz/ramure/commit/abc123';
    expect(commitUrl('git@github.com:Shawiizz/ramure.git', id)).toBe(page);
    expect(commitUrl('https://github.com/Shawiizz/ramure.git', id)).toBe(page);
    expect(commitUrl('https://someone@github.com/Shawiizz/ramure', id)).toBe(page);
    expect(commitUrl('ssh://git@github.com:22/Shawiizz/ramure.git', id)).toBe(page);
  });

  it('follows the website: Bitbucket says commits, GitLab keeps its groups', () => {
    expect(commitUrl('git@bitbucket.org:team/app.git', id)).toBe(
      'https://bitbucket.org/team/app/commits/abc123',
    );
    expect(commitUrl('https://gitlab.com/group/sub/app.git', id)).toBe(
      'https://gitlab.com/group/sub/app/commit/abc123',
    );
  });

  it('is none for a remote that is a folder', () => {
    expect(commitUrl('C:/repos/remote.git', id)).toBeNull();
    expect(commitUrl('/srv/git/remote.git', id)).toBeNull();
    expect(commitUrl('file:///srv/git/remote.git', id)).toBeNull();
  });
});
