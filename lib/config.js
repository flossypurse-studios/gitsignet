import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const REPO_CONFIG = '.gitsignet.json';

export function globalConfigPath() {
  const base =
    process.env.GITSIGNET_CONFIG_HOME ||
    process.env.XDG_CONFIG_HOME ||
    join(homedir(), '.config');
  return join(base, 'gitsignet', 'config.json');
}

// Returns { path, config } for the first config found, or null.
// Precedence: a repo-local .gitsignet.json overrides the global config.
export function loadConfig(repoRoot) {
  const candidates = [];
  if (repoRoot) candidates.push(join(repoRoot, REPO_CONFIG));
  candidates.push(globalConfigPath());
  for (const path of candidates) {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf8');
      let config;
      try {
        config = JSON.parse(raw);
      } catch (e) {
        throw new Error(`invalid JSON in ${path}: ${e.message}`);
      }
      return { path, config: normalizeConfig(config) };
    }
  }
  return null;
}

function normalizeConfig(config) {
  return {
    strict: config.strict === true,
    profiles: config.profiles && typeof config.profiles === 'object' ? config.profiles : {},
    rules: Array.isArray(config.rules) ? config.rules : [],
  };
}

// Resolve a rule's expected identity, dereferencing a named profile.
export function resolveIdentity(rule, config) {
  if (rule.name || rule.email) {
    return { name: rule.name || null, email: rule.email || null };
  }
  if (rule.profile && config.profiles[rule.profile]) {
    const p = config.profiles[rule.profile];
    return { name: p.name || null, email: p.email || null };
  }
  return null;
}
