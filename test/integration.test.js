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
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
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
