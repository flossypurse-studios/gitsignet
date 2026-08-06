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

// Find the first rule whose `remote` glob matches the parsed remote.
// The candidate strings tried are "host/owner/repo" and "host/owner",
// so a rule can target a whole org or a single repo.
export function matchRule(rules, remote) {
  if (!remote) return null;
  const candidates = [];
  if (remote.repo) candidates.push(`${remote.host}/${remote.path}`);
  candidates.push(`${remote.host}/${remote.owner}`);
  candidates.push(remote.host);
  for (const rule of rules) {
    if (!rule || typeof rule.remote !== 'string') continue;
    const pattern = rule.remote.toLowerCase().replace(/\/+$/, '');
    const re = globToRegExp(pattern);
    if (candidates.some((c) => re.test(c))) return rule;
  }
  return null;
}
