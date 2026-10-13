import { branchUrl, commitUrl, remoteUrl } from './web-url';

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

describe('a branch and a remote on their website', () => {
  it('are found from the remote', () => {
    expect(branchUrl('git@github.com:Shawiizz/ramure.git', 'feature/x')).toBe(
      'https://github.com/Shawiizz/ramure/tree/feature/x',
    );
    expect(branchUrl('git@bitbucket.org:team/app.git', 'main')).toBe(
      'https://bitbucket.org/team/app/branch/main',
    );
    expect(remoteUrl('ssh://git@gitlab.com/group/app.git')).toBe('https://gitlab.com/group/app');
    expect(remoteUrl('/srv/git/remote.git')).toBeNull();
  });
});
