// Convert a simple glob into a RegExp.
//   *  matches any run of characters except "/"
//   ** matches any run of characters including "/"
// Everything else is matched literally.
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

function remoteCandidates(remote) {
  const candidates = [];
  if (remote.repo) candidates.push(`${remote.host}/${remote.path}`);
  candidates.push(`${remote.host}/${remote.owner}`);
  candidates.push(remote.host);
  return candidates;
}

// Find the first rule whose `remote` glob matches the parsed remote.
// The candidate strings tried are "host/owner/repo" and "host/owner",
// so a rule can target a whole org or a single repo.
export function matchRule(rules, remote) {
  if (!remote || !Array.isArray(rules)) return null;
  const candidates = remoteCandidates(remote);
  for (const rule of rules) {
    if (!rule || typeof rule.remote !== 'string') continue;
    const pattern = rule.remote.toLowerCase().replace(/\/+$/, '');
    const re = globToRegExp(pattern);
    if (candidates.some((c) => re.test(c))) return rule;
  }
  return null;
}

// Return every rule (with its index) whose glob matches the remote, in
// config order. The first entry is the winner; any others are "shadowed"
// — they can never apply to this remote because an earlier rule already
// claimed it. Used by `doctor` to warn about config footguns.
export function matchAll(rules, remote) {
  if (!remote || !Array.isArray(rules)) return [];
  const candidates = remoteCandidates(remote);
  const out = [];
  rules.forEach((rule, index) => {
    if (!rule || typeof rule.remote !== 'string') return;
    const pattern = rule.remote.toLowerCase().replace(/\/+$/, '');
    const re = globToRegExp(pattern);
    if (candidates.some((c) => re.test(c))) out.push({ rule, index });
  });
  return out;
}
