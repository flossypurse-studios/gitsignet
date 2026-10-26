import { currentIdentity, remoteUrl, repoRoot } from './git.js';
import { parseRemote } from './remote.js';
import { loadConfig, resolveIdentity } from './config.js';
import { matchRule, matchAll, matchNoRemote } from './match.js';

// Statuses:
//   ok        — identity matches the expected rule
//   mismatch  — a rule matched but the current identity differs (BLOCK)
//   no-rule   — a config exists but no rule matched this remote
//   no-remote — the repo has no origin remote to key rules off
//   no-config — no .gitsignet.json or global config found
//   no-identity — git has no user.name/user.email configured
//   placeholder — no origin remote, no "(none)" rule, and the identity is a
//                 placeholder no person commits as (BLOCK)

// Domains reserved for examples and testing (RFC 2606, RFC 6761). An email at
// one of them is never a real author: it is what CI images and setup scripts
// write into a global gitconfig (e.g. ci@example.com) and what leaks into a
// commit when nothing else sets an identity.
const PLACEHOLDER_DOMAINS = ['example.com', 'example.net', 'example.org'];
const PLACEHOLDER_TLDS = ['example', 'invalid', 'test', 'localhost'];

export function isPlaceholderEmail(email) {
  if (!email || typeof email !== 'string') return false;
  // git strips surrounding whitespace and <> from user.email, so
  // "<ci@example.com>" still commits as ci@example.com.
  const bare = email.trim().replace(/^<+/, '').replace(/>+$/, '').trim();
  const at = bare.lastIndexOf('@');
  if (at === -1) return false;
  const domain = bare.slice(at + 1).trim().toLowerCase().replace(/\.+$/, '');
  if (!domain) return false;
  if (PLACEHOLDER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return PLACEHOLDER_TLDS.includes(tld);
}

export function evaluate({ remote = 'origin' } = {}) {
  const root = repoRoot();
  const identity = currentIdentity();
  const url = remoteUrl(remote);
  const parsed = parseRemote(url);

  const loaded = loadConfig(root);
  if (!loaded) {
    return { status: 'no-config', identity, remote: parsed, url };
  }
  const { config, path: configPath } = loaded;

  // Resolve the rule / expected identity up front so callers (e.g. `fix`)
  // can access the authoritative identity even when git has none set yet.
  const matches = parsed ? matchAll(config.rules, parsed) : [];
  let rule = matches.length ? matches[0].rule : null;
  let shadowed = matches.slice(1);
  // With no origin remote, an explicit "(none)" rule can still apply (issue #1).
  if (!parsed && !rule) {
    rule = matchNoRemote(config.rules);
    shadowed = [];
  }
  const expected = rule ? resolveIdentity(rule, config) : null;

  if (!identity.name || !identity.email) {
    return {
      status: 'no-identity',
      identity,
      expected,
      remote: parsed,
      url,
      configPath,
      config,
      rule,
      strict: config.strict,
    };
  }

  if (!parsed) {
    if (!rule || !expected) {
      // No origin at all means no rule can say who should commit here, so the
      // one thing still checkable is an identity no person ever commits as. A
      // "(none)" rule takes precedence above. An origin that is set but not a
      // host URL (a local path, file://) is left as it was: it is a remote.
      if (!url && isPlaceholderEmail(identity.email)) {
        return { status: 'placeholder', identity, remote: null, url, configPath, config, strict: config.strict };
      }
      return { status: 'no-remote', identity, remote: null, url, configPath, config, strict: config.strict };
    }
    const nameOk = !expected.name || expected.name === identity.name;
    const emailOk = !expected.email || expected.email === identity.email;
    if (nameOk && emailOk) {
      return { status: 'ok', identity, expected, remote: null, url, configPath, config, rule, shadowed: [] };
    }
    return { status: 'mismatch', identity, expected, remote: null, url, configPath, config, rule, shadowed: [], nameOk, emailOk };
  }

  if (!rule || !expected) {
    return { status: 'no-rule', identity, remote: parsed, url, configPath, config, rule, strict: config.strict };
  }

  const nameOk = !expected.name || expected.name === identity.name;
  const emailOk = !expected.email || expected.email === identity.email;
  if (nameOk && emailOk) {
    return { status: 'ok', identity, expected, remote: parsed, url, configPath, config, rule, shadowed };
  }
  return {
    status: 'mismatch',
    identity,
    expected,
    remote: parsed,
    url,
    configPath,
    config,
    rule,
    shadowed,
    nameOk,
    emailOk,
  };
}
