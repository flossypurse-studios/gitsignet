import { execFileSync } from 'node:child_process';

// Thrown when git itself could not answer: the binary is missing, it was killed,
// or it failed in a way that is not one of the ordinary "no" answers below.
// A guard must never read this as "nothing to check" — see check().
export class GitUnavailableError extends Error {
  constructor(args, cause) {
    const why = cause && (cause.code || (cause.signal && `killed by ${cause.signal}`) ||
      (typeof cause.status === 'number' && `exit ${cause.status}`)) || 'unknown error';
    const detail = cause && cause.stderr ? String(cause.stderr).trim().split('\n')[0] : '';
    super(`git ${args.join(' ')} failed (${why})${detail ? `: ${detail}` : ''}`, { cause });
    this.name = 'GitUnavailableError';
  }
}

// Run git. `expected` lists the exit codes that are an ordinary "no" for this
// call (e.g. 1 for `git config --get` on an unset key); those return null.
// Anything else — git missing, killed, or failing some other way — throws.
function git(args, { expected = [], expectStderr = null } = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Untranslated messages: the "not a git repository" match below must not
      // depend on the user's locale.
      env: { ...process.env, LC_ALL: 'C' },
    }).trim();
  } catch (err) {
    const ordinary =
      typeof err.status === 'number' &&
      expected.includes(err.status) &&
      (!expectStderr || expectStderr.test(String(err.stderr || '')));
    if (ordinary) return null;
    throw new GitUnavailableError(args, err);
  }
}

// `git config --get` exits 1 when the key is unset; that is a normal answer.
const configGet = (key) => git(['config', '--get', key], { expected: [1] });

// True inside a work tree, false only when git positively says this is not a
// repository. A git that cannot run, or a repository git refuses to read
// (e.g. dubious ownership, corruption), throws instead of reading as "not a repo".
export function isGitRepo() {
  return (
    git(['rev-parse', '--is-inside-work-tree'], {
      expected: [128],
      expectStderr: /not a git repository/i,
    }) === 'true'
  );
}

// The top-level directory of the current working tree.
export function repoRoot() {
  return git(['rev-parse', '--show-toplevel'], {
    expected: [128],
    expectStderr: /not a git repository/i,
  });
}

// The directory git uses for hooks (honours core.hooksPath).
export function hooksDir() {
  const custom = configGet('core.hooksPath');
  const gitDir = git(['rev-parse', '--git-path', 'hooks']);
  return custom || gitDir || '.git/hooks';
}

// The identity a commit made right now would use, mirroring git's own
// precedence (env vars > config). Returns { name, email }.
export function currentIdentity() {
  const name =
    process.env.GIT_AUTHOR_NAME ||
    configGet('user.name') ||
    null;
  const email =
    process.env.GIT_AUTHOR_EMAIL ||
    configGet('user.email') ||
    null;
  return { name, email };
}

export function remoteUrl(remote = 'origin') {
  return configGet(`remote.${remote}.url`);
}

// Set a local git config value, surfacing failures (unlike the silent
// read helpers above, which throw). Returns true on success, false on failure.
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
