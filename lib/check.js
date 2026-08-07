import { currentIdentity, remoteUrl, repoRoot } from './git.js';
import { parseRemote } from './remote.js';
import { loadConfig, resolveIdentity } from './config.js';
import { matchRule } from './match.js';

// Statuses:
//   ok        — identity matches the expected rule
//   mismatch  — a rule matched but the current identity differs (BLOCK)
//   no-rule   — a config exists but no rule matched this remote
//   no-remote — the repo has no origin remote to key rules off
//   no-config — no .gitsignet.json or global config found
//   no-identity — git has no user.name/user.email configured
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
  const rule = parsed ? matchRule(config.rules, parsed) : null;
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
    return { status: 'no-remote', identity, remote: null, url, configPath, config, strict: config.strict };
  }

  if (!rule || !expected) {
    return { status: 'no-rule', identity, remote: parsed, url, configPath, config, rule, strict: config.strict };
  }

  const nameOk = !expected.name || expected.name === identity.name;
  const emailOk = !expected.email || expected.email === identity.email;
  if (nameOk && emailOk) {
    return { status: 'ok', identity, expected, remote: parsed, url, configPath, config, rule };
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
    nameOk,
    emailOk,
  };
}
