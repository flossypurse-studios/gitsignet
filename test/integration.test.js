import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', 'bin', 'gitsignet.js');

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Run the CLI, returning { code, stdout, stderr }. Never throws on non-zero exit.
function run(args, cwd, env = {}) {
  const r = spawnSync('node', [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function setupRepo({ remote, name, email, config } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gitsignet-'));
  sh('git', ['init', '-b', 'main', '-q'], dir);
  if (name) sh('git', ['config', 'user.name', name], dir);
  if (email) sh('git', ['config', 'user.email', email], dir);
  if (remote) sh('git', ['remote', 'add', 'origin', remote], dir);
  if (config) writeFileSync(join(dir, '.gitsignet.json'), JSON.stringify(config));
  return dir;
}

const WORK_CONFIG = {
  strict: false,
  profiles: { work: { name: 'Work Me', email: 'me@acme.com' } },
  rules: [{ remote: 'github.com/acme-*', profile: 'work' }],
};

test('check: exit 0 when identity matches the rule', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Work Me',
    email: 'me@acme.com',
    config: WORK_CONFIG,
  });
  try {
    const r = run(['check'], dir);
    assert.equal(r.code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check: exit 1 and message when identity mismatches', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Wrong Person',
    email: 'wrong@example.com',
    config: WORK_CONFIG,
  });
  try {
    const r = run(['check'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /commit blocked/);
    assert.match(r.stderr, /me@acme\.com/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check: exit 0 (allowed) when no rule matches and strict is off', () => {
  const dir = setupRepo({
    remote: 'git@github.com:someone-else/thing.git',
    name: 'Whoever',
    email: 'who@ever.com',
    config: WORK_CONFIG,
  });
  try {
    const r = run(['check'], dir);
    assert.equal(r.code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check: exit 1 when no rule matches and strict is on', () => {
  const dir = setupRepo({
    remote: 'git@github.com:someone-else/thing.git',
    name: 'Whoever',
    email: 'who@ever.com',
    config: { ...WORK_CONFIG, strict: true },
  });
  try {
    const r = run(['check'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /strict/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check: exit 0 (no-op) when there is no config', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Anyone',
    email: 'any@one.com',
  });
  try {
    const r = run(['check'], dir);
    assert.equal(r.code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check --hook: silent on success, no stdout', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Work Me',
    email: 'me@acme.com',
    config: WORK_CONFIG,
  });
  try {
    const r = run(['check', '--hook'], dir);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check: env GIT_AUTHOR_* overrides config identity', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Work Me',
    email: 'me@acme.com',
    config: WORK_CONFIG,
  });
  try {
    // git config is correct, but env vars force a wrong identity → block
    const r = run(['check'], dir, {
      GIT_AUTHOR_NAME: 'Wrong',
      GIT_AUTHOR_EMAIL: 'wrong@example.com',
    });
    assert.equal(r.code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('doctor: exit 1 and mismatch report on wrong identity', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Wrong Person',
    email: 'wrong@example.com',
    config: WORK_CONFIG,
  });
  try {
    const r = run(['doctor'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /does NOT match/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('doctor: warns about shadowed rules (broad rule before specific)', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme/widgets.git',
    name: 'Work Me',
    email: 'me@acme.com',
    config: {
      strict: false,
      profiles: { work: { name: 'Work Me', email: 'me@acme.com' } },
      rules: [
        { remote: 'github.com/*', profile: 'work' },
        { remote: 'github.com/acme/widgets', profile: 'work' },
      ],
    },
  });
  try {
    const r = run(['doctor'], dir);
    assert.match(r.stdout, /shadowed/);
    assert.match(r.stdout, /github\.com\/acme\/widgets/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install then uninstall a pre-commit hook', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Work Me',
    email: 'me@acme.com',
    config: WORK_CONFIG,
  });
  const hook = join(dir, '.git', 'hooks', 'pre-commit');
  try {
    const i = run(['install'], dir);
    assert.equal(i.code, 0);
    assert.ok(existsSync(hook));
    assert.match(readFileSync(hook, 'utf8'), /gitsignet guard/);

    // idempotent
    const i2 = run(['install'], dir);
    assert.equal(i2.code, 0);
    assert.match(i2.stdout, /already installed/);

    const u = run(['uninstall'], dir);
    assert.equal(u.code, 0);
    assert.ok(!existsSync(hook)); // was otherwise empty → deleted
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installed hook fails open with a warning when gitsignet is absent', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Work Me',
    email: 'me@acme.com',
    config: WORK_CONFIG,
  });
  const hook = join(dir, '.git', 'hooks', 'pre-commit');
  const emptyBin = mkdtempSync(join(tmpdir(), 'gitsignet-emptybin-'));
  try {
    run(['install'], dir);
    // Run the generated hook with a PATH that contains neither gitsignet nor npx,
    // simulating a clone where the tool was never installed. It must exit 0
    // (commit allowed) and warn on stderr rather than hard-blocking the commit.
    const res = spawnSync('/bin/sh', [hook], {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: emptyBin },
    });
    assert.equal(res.status, 0, 'commit must not be hard-blocked when tool is absent');
    assert.match(res.stderr, /not installed/);
  } finally {
    rmSync(emptyBin, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install preserves an existing pre-commit hook', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Work Me',
    email: 'me@acme.com',
    config: WORK_CONFIG,
  });
  const hook = join(dir, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho "existing hook"\n');
  try {
    run(['install'], dir);
    const body = readFileSync(hook, 'utf8');
    assert.match(body, /existing hook/);
    assert.match(body, /gitsignet guard/);

    run(['uninstall'], dir);
    const after = readFileSync(hook, 'utf8');
    assert.match(after, /existing hook/);
    assert.ok(!after.includes('gitsignet guard'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init writes a sample .gitsignet.json', () => {
  const dir = setupRepo({ remote: 'git@github.com:acme-corp/widgets.git', name: 'X', email: 'x@y.z' });
  try {
    const r = run(['init'], dir);
    assert.equal(r.code, 0);
    const cfg = JSON.parse(readFileSync(join(dir, '.gitsignet.json'), 'utf8'));
    assert.ok(cfg.profiles);
    assert.ok(Array.isArray(cfg.rules));
    // second init is a no-op, doesn't clobber
    const r2 = run(['init'], dir);
    assert.equal(r2.code, 0);
    assert.match(r2.stdout, /already exists/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a real commit is blocked by the installed hook', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Wrong Person',
    email: 'wrong@example.com',
    config: WORK_CONFIG,
  });
  try {
    // Make the hook invoke this checkout's bin via an absolute PATH shim.
    run(['install'], dir);
    // Rewrite the hook to call our bin directly (global gitsignet isn't installed in CI).
    const hook = join(dir, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, `#!/bin/sh\nnode ${BIN} check --hook || exit 1\n`);
    sh('chmod', ['+x', hook], dir);

    writeFileSync(join(dir, 'file.txt'), 'hello');
    sh('git', ['add', '.'], dir);
    let blocked = false;
    try {
      execFileSync('git', ['commit', '-m', 'test'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' },
      });
    } catch {
      blocked = true;
    }
    assert.ok(blocked, 'commit should have been blocked by the hook');

    // Fix identity → commit succeeds
    sh('git', ['config', 'user.name', 'Work Me'], dir);
    sh('git', ['config', 'user.email', 'me@acme.com'], dir);
    sh('git', ['commit', '-m', 'test'], dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- fix ---------------------------------------------------------------

function gitConfig(dir, key) {
  try {
    return sh('git', ['config', '--local', '--get', key], dir).trim();
  } catch {
    return '';
  }
}

test('fix: sets local config when identity mismatches', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Wrong Name',
    email: 'wrong@example.com',
    config: WORK_CONFIG,
  });
  try {
    const r = run(['fix'], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /applied the expected identity/);
    assert.equal(gitConfig(dir, 'user.name'), 'Work Me');
    assert.equal(gitConfig(dir, 'user.email'), 'me@acme.com');
    // guard now passes
    assert.equal(run(['check'], dir).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fix: sets local config when git has no identity', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    config: WORK_CONFIG,
  });
  try {
    const r = run(['fix'], dir);
    assert.equal(r.code, 0);
    assert.equal(gitConfig(dir, 'user.name'), 'Work Me');
    assert.equal(gitConfig(dir, 'user.email'), 'me@acme.com');
    assert.equal(run(['check'], dir).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fix: idempotent no-op when identity already matches', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Work Me',
    email: 'me@acme.com',
    config: WORK_CONFIG,
  });
  try {
    const r = run(['fix'], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /already matches/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fix: exit 1 and refusal when no rule matches the remote', () => {
  const dir = setupRepo({
    remote: 'git@github.com:other-org/thing.git',
    name: 'Wrong Name',
    email: 'wrong@example.com',
    config: WORK_CONFIG,
  });
  try {
    const r = run(['fix'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no rule with an expected identity matched/);
    // identity untouched
    assert.equal(gitConfig(dir, 'user.name'), 'Wrong Name');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- issue #1: "(none)" rule guards repos with no origin remote -------------
const NONE_CONFIG = {
  strict: false,
  profiles: { me: { name: 'Right Person', email: 'right@example.com' } },
  rules: [{ remote: '(none)', profile: 'me' }],
};

test('check: "(none)" rule blocks wrong identity when repo has no remote', () => {
  const dir = setupRepo({
    name: 'Wrong Person',
    email: 'wrong@example.com',
    config: NONE_CONFIG,
  });
  try {
    const r = run(['check', '--hook'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /wrong identity/);
    assert.match(r.stderr, /no origin remote/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check: "(none)" rule passes matching identity when repo has no remote', () => {
  const dir = setupRepo({
    name: 'Right Person',
    email: 'right@example.com',
    config: NONE_CONFIG,
  });
  try {
    const r = run(['check', '--hook'], dir);
    assert.equal(r.code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('doctor: "(none)" rule reports mismatch for a remoteless repo', () => {
  const dir = setupRepo({
    name: 'Wrong Person',
    email: 'wrong@example.com',
    config: NONE_CONFIG,
  });
  try {
    const r = run(['doctor'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /does NOT match/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fix: "(none)" rule applies expected identity to a remoteless repo', () => {
  const dir = setupRepo({
    name: 'Wrong Person',
    email: 'wrong@example.com',
    config: NONE_CONFIG,
  });
  try {
    const r = run(['fix'], dir);
    assert.equal(r.code, 0);
    assert.equal(gitConfig(dir, 'user.name'), 'Right Person');
    assert.equal(gitConfig(dir, 'user.email'), 'right@example.com');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no-remote without a "(none)" rule stays inert in non-strict mode', () => {
  const dir = setupRepo({
    name: 'Wrong Person',
    email: 'wrong@example.com',
    config: WORK_CONFIG,
  });
  try {
    const r = run(['check', '--hook'], dir);
    assert.equal(r.code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- issue #2: install warns when the hook cannot resolve gitsignet ---------
test('install: warns loudly when gitsignet is not resolvable by the hook', () => {
  const dir = setupRepo({ name: 'A', email: 'a@b.c', config: NONE_CONFIG });
  try {
    // In a fresh temp repo gitsignet is not resolvable by the hook → warning fires.
    const r = run(['install'], dir);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /FALL OPEN|not installed where the hook can find it/);
    assert.match(r.stderr, /npm i -g gitsignet/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- regression: --version must equal package.json, not a hardcoded literal --
// v0.1.5 shipped with `const VERSION = '0.1.4'` in bin/gitsignet.js, so the
// published CLI under-reported its own version. The version is now read from
// package.json; this test fails if anyone reintroduces a literal that drifts.
test('--version reports the real package.json version', () => {
  const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
  const dir = setupRepo({ name: 'A', email: 'a@b.c' });
  try {
    for (const flag of ['--version', '-v']) {
      const r = run([flag], dir);
      assert.equal(r.code, 0, `${flag} should exit 0`);
      assert.equal(r.stdout.trim(), pkg.version, `${flag} must print ${pkg.version}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- cold review (issue #6): the identity check itself is untested ---------
//
// These tests force GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL explicitly on every
// `run()` call so the assertion is deterministic regardless of any ambient
// GIT_AUTHOR_*/GIT_COMMITTER_* env vars in the host environment (see
// currentIdentity() in lib/git.js, which prefers env vars over git config).

test('check: mismatch when name matches but email does not (remote path)', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Work Me',
    email: 'wrong@example.com',
    config: WORK_CONFIG,
  });
  try {
    const r = run(['check'], dir, { GIT_AUTHOR_NAME: 'Work Me', GIT_AUTHOR_EMAIL: 'wrong@example.com' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /commit blocked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check: mismatch when email matches but name does not (remote path)', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Wrong Name',
    email: 'me@acme.com',
    config: WORK_CONFIG,
  });
  try {
    const r = run(['check'], dir, { GIT_AUTHOR_NAME: 'Wrong Name', GIT_AUTHOR_EMAIL: 'me@acme.com' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /commit blocked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check: mismatch when name matches but email does not (no-remote "(none)" path)', () => {
  const dir = setupRepo({
    name: 'Right Person',
    email: 'wrong@example.com',
    config: NONE_CONFIG,
  });
  try {
    const r = run(['check', '--hook'], dir, { GIT_AUTHOR_NAME: 'Right Person', GIT_AUTHOR_EMAIL: 'wrong@example.com' });
    assert.equal(r.code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check: mismatch when email matches but name does not (no-remote "(none)" path)', () => {
  const dir = setupRepo({
    name: 'Wrong Person',
    email: 'right@example.com',
    config: NONE_CONFIG,
  });
  try {
    const r = run(['check', '--hook'], dir, { GIT_AUTHOR_NAME: 'Wrong Person', GIT_AUTHOR_EMAIL: 'right@example.com' });
    assert.equal(r.code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('remote rule matching is case-insensitive on the host', () => {
  // Strict mode makes a rule-miss observable (exit 1) instead of silently
  // allowed, so this test actually distinguishes "matched" from "not matched".
  const dir = setupRepo({
    remote: 'git@MyGit.Company.com:owner/repo.git',
    name: 'Work Me',
    email: 'me@acme.com',
    config: {
      strict: true,
      profiles: { work: { name: 'Work Me', email: 'me@acme.com' } },
      rules: [{ remote: 'mygit.company.com/owner/*', profile: 'work' }],
    },
  });
  try {
    const r = run(['check'], dir, { GIT_AUTHOR_NAME: 'Work Me', GIT_AUTHOR_EMAIL: 'me@acme.com' });
    assert.equal(r.code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check: strict mode blocks a remoteless repo with no "(none)" rule', () => {
  const dir = setupRepo({
    name: 'Whoever',
    email: 'who@ever.com',
    config: { ...WORK_CONFIG, strict: true },
  });
  try {
    const r = run(['check'], dir, { GIT_AUTHOR_NAME: 'Whoever', GIT_AUTHOR_EMAIL: 'who@ever.com' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /strict/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check: exit 1 when git has no identity at all', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    config: WORK_CONFIG,
  });
  try {
    // Isolate from any global/system git config on the host (which may set
    // a real user.name/email) so this genuinely exercises "no identity".
    const r = run(['check'], dir, {
      GIT_AUTHOR_NAME: '',
      GIT_AUTHOR_EMAIL: '',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no user\.name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('"(none)" rule requires an exact match, not a substring', () => {
  const dir = setupRepo({
    name: 'Right Person',
    email: 'right@example.com',
    config: {
      strict: false,
      profiles: { me: { name: 'Right Person', email: 'right@example.com' } },
      // This rule's remote pattern merely *contains* "none" — it must NOT be
      // treated as the no-remote catch-all, even though the identity here
      // would satisfy it if it were wrongly matched.
      rules: [{ remote: 'nonematch', profile: 'me' }],
    },
  });
  try {
    // No real "(none)" rule and no origin remote → status must be "no-remote"
    // (inert, allowed), NOT "ok" via a wrongly-matched "nonematch" rule.
    const r = run(['doctor'], dir, { GIT_AUTHOR_NAME: 'Right Person', GIT_AUTHOR_EMAIL: 'right@example.com' });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /no origin remote/);
    assert.doesNotMatch(r.stdout, /matches the rule/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('email comparison is case-sensitive', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Work Me',
    email: 'User@Company.com',
    config: {
      strict: false,
      profiles: { work: { name: 'Work Me', email: 'user@company.com' } },
      rules: [{ remote: 'github.com/acme-*', profile: 'work' }],
    },
  });
  try {
    const r = run(['check'], dir, { GIT_AUTHOR_NAME: 'Work Me', GIT_AUTHOR_EMAIL: 'User@Company.com' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /commit blocked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- A guard that cannot evaluate must block, never pass -------------------

// A PATH holding node and a stand-in `git` script (or no git at all).
function fakePath({ gitScript = null } = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'gitsignet-path-'));
  execFileSync('ln', ['-s', process.execPath, join(bin, 'node')]);
  if (gitScript) {
    writeFileSync(join(bin, 'git'), `#!/bin/sh\n${gitScript}\n`, { mode: 0o755 });
  }
  return bin;
}

test('check --hook: blocks when git cannot run at all', () => {
  const dir = setupRepo({ config: WORK_CONFIG });
  const bin = fakePath();
  try {
    const r = run(['check', '--hook'], dir, { PATH: bin });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /could not verify the commit identity/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test('check --hook: blocks when git fails for a reason other than "not a repo"', () => {
  const dir = setupRepo({ config: WORK_CONFIG });
  const bin = fakePath({ gitScript: 'echo "fatal: detected dubious ownership" >&2; exit 128' });
  try {
    const r = run(['check', '--hook'], dir, { PATH: bin });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /dubious ownership/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test('check --hook: blocks when reading the remote fails', () => {
  const dir = setupRepo({ config: WORK_CONFIG });
  // rev-parse works; every `git config` call fails with an unexpected code.
  const bin = fakePath({
    gitScript: `case "$1" in
  rev-parse) [ "$2" = "--is-inside-work-tree" ] && echo true || echo "${dir}"; exit 0 ;;
  *) echo "fatal: bad config line 1" >&2; exit 3 ;;
esac`,
  });
  try {
    const r = run(['check', '--hook'], dir, { PATH: bin });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /bad config line/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test('check --hook: still a no-op outside a git repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitsignet-norepo-'));
  try {
    const r = run(['check', '--hook'], dir, { GIT_CEILING_DIRECTORIES: dirname(dir) });
    assert.equal(r.code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed .gitsignet.json: blocks with one clean line, no stack trace', () => {
  const dir = setupRepo({ remote: 'git@github.com:acme-corp/widgets.git', name: 'A', email: 'a@b.c' });
  writeFileSync(join(dir, '.gitsignet.json'), '{ not json');
  try {
    const hook = run(['check', '--hook'], dir);
    assert.equal(hook.code, 1);
    assert.match(hook.stderr, /invalid JSON/);
    assert.doesNotMatch(hook.stderr, /^\s+at /m);
    const doc = run(['doctor'], dir);
    assert.equal(doc.code, 1);
    assert.match(doc.stderr, /^gitsignet: invalid JSON/m);
    assert.doesNotMatch(doc.stderr, /^\s+at /m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check --json / doctor --json: machine-readable result', () => {
  const dir = setupRepo({
    remote: 'git@github.com:acme-corp/widgets.git',
    name: 'Someone Else',
    email: 'else@example.com',
    config: WORK_CONFIG,
  });
  try {
    const r = run(['check', '--json'], dir);
    assert.equal(r.code, 1);
    const j = JSON.parse(r.stdout);
    assert.equal(j.status, 'mismatch');
    assert.equal(j.ok, false);
    assert.equal(j.expected.email, 'me@acme.com');
    assert.equal(j.identity.email, 'else@example.com');
    const d = JSON.parse(run(['doctor', '--json'], dir).stdout);
    assert.equal(d.status, 'mismatch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
