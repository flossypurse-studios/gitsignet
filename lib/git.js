import { execFileSync } from 'node:child_process';

function git(args, opts = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

export function isGitRepo() {
  return git(['rev-parse', '--is-inside-work-tree']) === 'true';
}

// The top-level directory of the current working tree.
export function repoRoot() {
  return git(['rev-parse', '--show-toplevel']);
}

// The directory git uses for hooks (honours core.hooksPath).
export function hooksDir() {
  const custom = git(['config', '--get', 'core.hooksPath']);
  const gitDir = git(['rev-parse', '--git-path', 'hooks']);
  return custom || gitDir || '.git/hooks';
}

// The identity a commit made right now would use, mirroring git's own
// precedence (env vars > config). Returns { name, email }.
export function currentIdentity() {
  const name =
    process.env.GIT_AUTHOR_NAME ||
    git(['config', '--get', 'user.name']) ||
    null;
  const email =
    process.env.GIT_AUTHOR_EMAIL ||
    git(['config', '--get', 'user.email']) ||
    null;
  return { name, email };
}

export function remoteUrl(remote = 'origin') {
  return git(['config', '--get', `remote.${remote}.url`]);
}

// Set a local git config value, surfacing failures (unlike the silent
// helper above). Returns true on success, false on failure.
export function setConfig(key, value, { global = false } = {}) {
  try {
    execFileSync('git', ['config', global ? '--global' : '--local', key, value], {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}
