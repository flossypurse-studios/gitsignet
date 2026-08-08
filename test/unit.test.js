import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemote } from '../lib/remote.js';
import { globToRegExp, matchRule, matchAll } from '../lib/match.js';
import { resolveIdentity } from '../lib/config.js';

test('parseRemote: scp-like ssh', () => {
  const r = parseRemote('git@github.com:acme/widgets.git');
  assert.deepEqual(r, { host: 'github.com', owner: 'acme', repo: 'widgets', path: 'acme/widgets' });
});

test('parseRemote: https with .git', () => {
  const r = parseRemote('https://github.com/acme/widgets.git');
  assert.equal(r.host, 'github.com');
  assert.equal(r.owner, 'acme');
  assert.equal(r.repo, 'widgets');
});

test('parseRemote: https with userinfo and port', () => {
  const r = parseRemote('https://user@bitbucket.org:443/team/repo.git');
  assert.equal(r.host, 'bitbucket.org');
  assert.equal(r.owner, 'team');
});

test('parseRemote: ssh scheme with port', () => {
  const r = parseRemote('ssh://git@github.com:22/acme/widgets.git');
  assert.equal(r.host, 'github.com');
  assert.equal(r.owner, 'acme');
});

test('parseRemote: nested gitlab groups', () => {
  const r = parseRemote('git@gitlab.com:group/subgroup/repo.git');
  assert.equal(r.owner, 'group');
  assert.equal(r.repo, 'repo');
  assert.equal(r.path, 'group/subgroup/repo');
});

test('parseRemote: junk returns null', () => {
  assert.equal(parseRemote(''), null);
  assert.equal(parseRemote(null), null);
  assert.equal(parseRemote('not a url'), null);
});

test('globToRegExp: single star stops at slash', () => {
  const re = globToRegExp('github.com/acme-*');
  assert.ok(re.test('github.com/acme-corp'));
  assert.ok(!re.test('github.com/other'));
  assert.ok(!re.test('github.com/acme-corp/extra'));
});

test('globToRegExp: double star crosses slash', () => {
  const re = globToRegExp('github.com/**');
  assert.ok(re.test('github.com/acme/widgets'));
});

test('matchRule: matches org-level rule via host/owner', () => {
  const remote = parseRemote('git@github.com:acme-corp/widgets.git');
  const rule = matchRule([{ remote: 'github.com/acme-*', profile: 'work' }], remote);
  assert.equal(rule.profile, 'work');
});

test('matchRule: first match wins', () => {
  const remote = parseRemote('git@github.com:acme/widgets.git');
  const rules = [
    { remote: 'github.com/acme/widgets', profile: 'specific' },
    { remote: 'github.com/acme', profile: 'org' },
  ];
  assert.equal(matchRule(rules, remote).profile, 'specific');
});

test('matchRule: no match returns null', () => {
  const remote = parseRemote('git@github.com:someone/thing.git');
  assert.equal(matchRule([{ remote: 'gitlab.com/*', profile: 'x' }], remote), null);
});

test('matchAll: returns all matching rules winner-first, skipping non-matches', () => {
  const remote = parseRemote('git@github.com:acme/widgets.git');
  const rules = [
    { remote: 'github.com/*', profile: 'broad' },
    { remote: 'gitlab.com/*', profile: 'other' },
    { remote: 'github.com/acme/widgets', profile: 'specific' },
  ];
  const matches = matchAll(rules, remote);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].rule.profile, 'broad');
  assert.equal(matches[0].index, 0);
  assert.equal(matches[1].rule.profile, 'specific');
  assert.equal(matches[1].index, 2);
});

test('matchAll: single match returns length 1', () => {
  const remote = parseRemote('git@github.com:acme/widgets.git');
  const matches = matchAll([{ remote: 'github.com/acme/*', profile: 'work' }], remote);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].rule.profile, 'work');
});

test('resolveIdentity: inline overrides profile', () => {
  const cfg = { profiles: { work: { name: 'W', email: 'w@x' } } };
  assert.deepEqual(resolveIdentity({ name: 'Inline', email: 'i@x' }, cfg), {
    name: 'Inline',
    email: 'i@x',
  });
});

test('resolveIdentity: dereferences profile', () => {
  const cfg = { profiles: { work: { name: 'W', email: 'w@x' } } };
  assert.deepEqual(resolveIdentity({ profile: 'work' }, cfg), { name: 'W', email: 'w@x' });
});

test('resolveIdentity: missing profile returns null', () => {
  assert.equal(resolveIdentity({ profile: 'nope' }, { profiles: {} }), null);
});

test('setConfig: writes local git config and returns true', async () => {
  const { setConfig } = await import('../lib/git.js');
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'gitsignet-unit-'));
  const cwd = process.cwd();
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    process.chdir(dir);
    const ok = setConfig('user.name', 'Unit Tester');
    assert.equal(ok, true);
    const got = execFileSync('git', ['config', '--local', '--get', 'user.name'], {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
    assert.equal(got, 'Unit Tester');
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
