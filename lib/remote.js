// Normalize a git remote URL into { host, owner, repo, path }.
// Handles the common forms:
//   git@github.com:owner/repo.git
//   https://github.com/owner/repo.git
//   ssh://git@github.com:22/owner/repo.git
//   https://user@bitbucket.org/team/repo.git
// For nested groups (e.g. GitLab), `owner` is the first path segment and
// `path` is the full owner/.../repo string.
export function parseRemote(url) {
  if (!url || typeof url !== 'string') return null;
  let host;
  let path;

  const scp = url.match(/^[^/@]+@([^:/]+):(.+)$/); // scp-like: git@host:path
  if (scp) {
    host = scp[1];
    path = scp[2];
  } else {
    const m = url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(.+)$/); // scheme://rest
    if (!m) return null;
    let rest = m[1];
    const slash = rest.indexOf('/');
    if (slash === -1) return null;
    let authority = rest.slice(0, slash);
    path = rest.slice(slash + 1);
    // strip userinfo@ and :port from authority
    authority = authority.replace(/^[^@]*@/, '').replace(/:\d+$/, '');
    host = authority;
  }

  path = path.replace(/\.git$/, '').replace(/\/+$/, '').replace(/^\/+/, '');
  if (!host || !path) return null;
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 1) return null;
  const owner = segments[0];
  const repo = segments.length > 1 ? segments[segments.length - 1] : null;
  return { host: host.toLowerCase(), owner, repo, path };
}
