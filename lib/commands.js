import { writeFileSync, existsSync, readFileSync, mkdirSync, chmodSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { evaluate } from './check.js';
import { isGitRepo, repoRoot, hooksDir, setConfig } from './git.js';
import { REPO_CONFIG, globalConfigPath } from './config.js';

const HOOK_MARK = '# >>> gitsignet guard >>>';
const HOOK_END = '# <<< gitsignet guard <<<';
const HOOK_BODY = `${HOOK_MARK}
# Managed by gitsignet — https://gitsignet.dev
if command -v gitsignet >/dev/null 2>&1; then
  gitsignet check --hook || exit 1
elif command -v npx >/dev/null 2>&1 && npx --no-install gitsignet --version >/dev/null 2>&1; then
  npx --no-install gitsignet check --hook || exit 1
else
  echo "gitsignet: not installed — skipping identity check (run 'npm i -g gitsignet' or 'gitsignet uninstall' to remove this hook)" >&2
fi
${HOOK_END}`;

function c(code, s) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}
const green = (s) => c('32', s);
const red = (s) => c('31', s);
const yellow = (s) => c('33', s);
const dim = (s) => c('2', s);
const bold = (s) => c('1', s);

function idStr(id) {
  if (!id || (!id.name && !id.email)) return dim('(none)');
  return `${id.name || '?'} <${id.email || '?'}>`;
}

export function doctor() {
  if (!isGitRepo()) {
    console.error(red('✗ not inside a git repository'));
    return 1;
  }
  const r = evaluate();
  console.log(bold('gitsignet doctor'));
  console.log(`  repo remote : ${r.url ? r.url : dim('(no origin remote)')}`);
  if (r.remote) {
    console.log(`  parsed      : ${r.remote.host}/${r.remote.path}`);
  }
  console.log(`  identity    : ${idStr(r.identity)}`);
  if (r.configPath) console.log(`  config      : ${r.configPath}`);

  switch (r.status) {
    case 'ok':
      console.log(`  rule        : ${r.rule.remote} → ${idStr(r.expected)}`);
      console.log(green('✓ identity matches the rule for this remote'));
      return 0;
    case 'mismatch':
      console.log(`  rule        : ${r.rule.remote} → expected ${idStr(r.expected)}`);
      console.log(red('✗ identity does NOT match this remote'));
      console.log(`    expected: ${idStr(r.expected)}`);
      console.log(`    current : ${idStr(r.identity)}`);
      console.log(dim('  fix: run `gitsignet fix` to apply the expected identity'));
      return 1;
    case 'no-config':
      console.log(yellow('• no gitsignet config found'));
      console.log(dim(`  run \`gitsignet init\` to create ${REPO_CONFIG}`));
      return 0;
    case 'no-identity':
      console.log(red('✗ git has no user.name / user.email configured'));
      return 1;
    case 'no-remote':
      console.log(yellow('• no origin remote — cannot match a remote-based rule'));
      return 0;
    case 'no-rule':
      console.log(
        r.strict
          ? red('✗ strict mode: no rule matches this remote')
          : yellow('• no rule matches this remote (allowed; strict mode is off)')
      );
      return r.strict ? 1 : 0;
    default:
      return 0;
  }
}

// `check` is the guard. In --hook mode it stays quiet on success and only
// speaks up (and fails) on a genuine mismatch / strict violation.
export function check({ hook = false } = {}) {
  if (!isGitRepo()) {
    if (hook) return 0; // don't get in the way outside a repo
    console.error(red('✗ not inside a git repository'));
    return 1;
  }
  const r = evaluate();
  switch (r.status) {
    case 'ok':
      if (!hook) console.log(green('✓ identity ok'));
      return 0;
    case 'mismatch':
      console.error(red('✗ gitsignet: wrong identity for this remote — commit blocked'));
      console.error(`  remote  : ${r.remote.host}/${r.remote.path}`);
      console.error(`  rule    : ${r.rule.remote}`);
      console.error(`  expected: ${idStr(r.expected)}`);
      console.error(`  current : ${idStr(r.identity)}`);
      console.error(dim('  fix     : run `gitsignet fix` to apply the expected identity'));
      return 1;
    case 'no-identity':
      console.error(red('✗ gitsignet: git has no user.name / user.email set — commit blocked'));
      return 1;
    case 'no-rule':
      if (r.strict) {
        console.error(red('✗ gitsignet: strict mode, no rule matches this remote — commit blocked'));
        return 1;
      }
      return 0;
    case 'no-remote':
      if (r.config && r.config.strict) {
        console.error(red('✗ gitsignet: strict mode, no origin remote to match — commit blocked'));
        return 1;
      }
      return 0;
    case 'no-config':
    default:
      return 0;
  }
}

// `fix` closes the loop: when the current identity is wrong (or unset) for
// this remote, it applies the identity the matching rule expects by setting
// the repo-local git config. With --global it writes the global config
// instead. It never touches identity when no rule matched — there is nothing
// authoritative to apply.
export function fix({ global = false } = {}) {
  if (!isGitRepo()) {
    console.error(red('✗ not inside a git repository'));
    return 1;
  }
  const r = evaluate();
  const scope = global ? 'global' : 'local';

  if (r.status === 'ok') {
    console.log(green('✓ identity already matches the rule for this remote — nothing to fix'));
    return 0;
  }

  if (r.status === 'no-config') {
    console.log(yellow('• no gitsignet config found — nothing to fix'));
    console.log(dim(`  run \`gitsignet init\` to create ${REPO_CONFIG}`));
    return 0;
  }

  if (!r.expected || (!r.expected.name && !r.expected.email)) {
    console.error(red('✗ no rule with an expected identity matched this remote — cannot fix'));
    console.log(dim('  add a rule to your gitsignet config, then run `gitsignet fix` again'));
    return 1;
  }

  const changes = [];
  let failed = false;
  if (r.expected.name && r.expected.name !== r.identity.name) {
    if (setConfig('user.name', r.expected.name, { global })) {
      changes.push(`user.name → ${r.expected.name}`);
    } else {
      failed = true;
    }
  }
  if (r.expected.email && r.expected.email !== r.identity.email) {
    if (setConfig('user.email', r.expected.email, { global })) {
      changes.push(`user.email → ${r.expected.email}`);
    } else {
      failed = true;
    }
  }

  if (failed) {
    console.error(red('✗ failed to set git config'));
    return 1;
  }
  if (changes.length === 0) {
    console.log(green('✓ identity already matches — nothing to fix'));
    return 0;
  }
  console.log(green(`✓ applied the expected identity (${scope} git config):`));
  for (const ch of changes) console.log(`    ${ch}`);
  console.log(dim('  run `gitsignet doctor` to confirm'));
  return 0;
}

export function install() {
  if (!isGitRepo()) {
    console.error(red('✗ not inside a git repository'));
    return 1;
  }
  const dir = hooksDir();
  mkdirSync(dir, { recursive: true });
  const hookPath = join(dir, 'pre-commit');
  let content = '';
  if (existsSync(hookPath)) {
    content = readFileSync(hookPath, 'utf8');
    if (content.includes(HOOK_MARK)) {
      console.log(green('✓ gitsignet guard already installed in pre-commit hook'));
      return 0;
    }
    if (!content.startsWith('#!')) content = `#!/bin/sh\n${content}`;
    content = `${content.replace(/\n*$/, '')}\n\n${HOOK_BODY}\n`;
  } else {
    content = `#!/bin/sh\n${HOOK_BODY}\n`;
  }
  writeFileSync(hookPath, content);
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    /* windows */
  }
  console.log(green(`✓ installed gitsignet guard → ${hookPath}`));
  return 0;
}

export function uninstall() {
  if (!isGitRepo()) {
    console.error(red('✗ not inside a git repository'));
    return 1;
  }
  const hookPath = join(hooksDir(), 'pre-commit');
  if (!existsSync(hookPath)) {
    console.log(yellow('• no pre-commit hook found'));
    return 0;
  }
  const content = readFileSync(hookPath, 'utf8');
  if (!content.includes(HOOK_MARK)) {
    console.log(yellow('• pre-commit hook exists but has no gitsignet guard'));
    return 0;
  }
  const re = new RegExp(`\\n*${escapeRe(HOOK_MARK)}[\\s\\S]*?${escapeRe(HOOK_END)}\\n*`, 'g');
  let stripped = content.replace(re, '\n');
  if (stripped.trim() === '#!/bin/sh' || stripped.trim() === '') {
    unlinkSync(hookPath);
    console.log(green('✓ removed gitsignet guard (hook was otherwise empty, deleted)'));
    return 0;
  }
  writeFileSync(hookPath, stripped);
  console.log(green('✓ removed gitsignet guard from pre-commit hook'));
  return 0;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SAMPLE = {
  strict: false,
  profiles: {
    work: { name: 'Your Work Name', email: 'you@company.com' },
    personal: { name: 'Your Name', email: 'you@personal.dev' },
  },
  rules: [
    { remote: 'github.com/your-company-*', profile: 'work' },
    { remote: 'github.com/your-username', profile: 'personal' },
  ],
};

export function init({ global = false } = {}) {
  let target;
  if (global) {
    target = globalConfigPath();
  } else {
    const root = repoRoot();
    if (!root) {
      console.error(red('✗ not inside a git repository (use --global to create the global config)'));
      return 1;
    }
    target = join(root, REPO_CONFIG);
  }
  if (existsSync(target)) {
    console.log(yellow(`• config already exists: ${target}`));
    return 0;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(SAMPLE, null, 2) + '\n');
  console.log(green(`✓ wrote sample config → ${target}`));
  console.log(dim('  edit it, then run `gitsignet install` to enable the pre-commit guard'));
  return 0;
}
