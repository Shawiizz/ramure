/**
 * A commit's page on the website hosting a remote (GitHub, GitLab, Bitbucket, Gitea…),
 * from the remote's URL in any of its forms; null for a remote that is a folder.
 */
export function commitUrl(remoteUrl: string, id: string): string | null {
  const site = siteOf(remoteUrl.trim());
  if (!site) return null;
  const commits = site.host.includes('bitbucket') ? 'commits' : 'commit';
  return `https://${site.host}/${site.path}/${commits}/${id}`;
}

/** A branch's page on the website hosting its remote; null for a remote that is a folder. */
export function branchUrl(remoteUrl: string, branch: string): string | null {
  const site = siteOf(remoteUrl.trim());
  if (!site) return null;
  const tree = site.host.includes('bitbucket') ? 'branch' : 'tree';
  return `https://${site.host}/${site.path}/${tree}/${branch}`;
}

/** The remote's own page on its website; null for a remote that is a folder. */
export function remoteUrl(url: string): string | null {
  const site = siteOf(url.trim());
  return site && `https://${site.host}/${site.path}`;
}

/** The `owner/repository` of a remote on GitHub; null for one elsewhere. */
export function githubRepository(url: string): string | null {
  const site = siteOf(url.trim());
  return site?.host === 'github.com' ? site.path : null;
}

function siteOf(url: string): { host: string; path: string } | null {
  // git@github.com:owner/repo.git
  const scp = /^[\w.-]+@([\w.-]+):(?!\/)(.+)$/.exec(url);
  // ssh://git@host:22/owner/repo.git, https://user@host/owner/repo.git, git://host/…
  const full = /^(?:ssh|https?|git):\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/(.+)$/.exec(url);
  const found = scp ?? full;
  if (!found) return null;
  const [, host, path] = found;
  return { host, path: path.replace(/\/+$/, '').replace(/\.git$/, '') };
}
