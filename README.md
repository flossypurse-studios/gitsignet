# gitsignet

**Stop committing to work repos as your personal self (and vice-versa).**
`gitsignet` is a git identity guard: it *blocks* a commit made under the wrong
author, using rules keyed off the repo's **remote** — so the right identity is
enforced no matter where you cloned the repo.

```
$ git commit -m "wip"
✗ gitsignet: wrong identity for this remote — commit blocked
  remote  : github.com/acme-corp/widgets
  rule    : github.com/acme-*
  expected: Work Me <me@acme.com>
  current : Personal Me <me@personal.dev>
  fix    : git config user.name "…" && git config user.email "…"
```

## Why

`git config includeIf` can switch identity — but it keys off the **directory**
the repo lives in, it is silent, and it never *stops* a bad commit. Clone a work
repo into the wrong folder, or forget to set `user.email` in a fresh clone, and
you will happily author commits as the wrong person. You find out when the commit
is already pushed with your personal email on a work repo (or your work email on
an open-source PR).

`gitsignet` keys rules off the **remote** instead of the directory, and it runs
as a `pre-commit` hook that **fails the commit** when the identity is wrong.

## Install

```sh
npm install -g gitsignet
```

Or run it without installing:

```sh
npx gitsignet doctor
```

## Quick start

```sh
# 1. See what identity you're about to commit as, and why:
gitsignet doctor

# 2. Create a config (writes .gitsignet.json in the repo, or --global):
gitsignet init --global

# 3. Edit the config, then enable the pre-commit guard in a repo:
gitsignet install
```

## Configuration

A `.gitsignet.json` in the repo overrides a global config at
`$XDG_CONFIG_HOME/gitsignet/config.json` (`~/.config/gitsignet/config.json`).
Keep one **global** config with all your identities and rules, and you never
have to think about it again.

```json
{
  "strict": false,
  "profiles": {
    "work":     { "name": "Work Me",     "email": "me@acme.com" },
    "personal": { "name": "Personal Me", "email": "me@personal.dev" }
  },
  "rules": [
    { "remote": "github.com/acme-*",        "profile": "work" },
    { "remote": "github.com/my-username",    "profile": "personal" },
    { "remote": "gitlab.com/**",             "name": "Personal Me", "email": "me@personal.dev" }
  ]
}
```

- **`profiles`** — named identities you can reuse across rules.
- **`rules`** — matched top-to-bottom; the first match wins. Each rule points at
  a `profile`, or gives an inline `name`/`email`.
- **`remote`** — a glob matched against `host/owner/repo`, `host/owner`, and
  `host`. `*` matches within one path segment; `**` crosses `/`. So
  `github.com/acme-*` matches a whole org, `github.com/acme/widgets` a single repo.
- **`strict`** — when `true`, a commit to a remote that matches **no** rule is
  blocked. Off by default (unmatched remotes are allowed).

## Commands

| Command | What it does |
| --- | --- |
| `gitsignet doctor` | Explain the identity you're about to commit as, the parsed remote, the matching rule, and whether it's ok. Never fails a commit. |
| `gitsignet check [--hook]` | The guard. Exit non-zero on a mismatch / strict violation. `--hook` stays quiet on success. |
| `gitsignet install` | Add the `gitsignet` guard to this repo's `pre-commit` hook (honours `core.hooksPath`). Idempotent; preserves an existing hook. |
| `gitsignet uninstall` | Remove the guard from the `pre-commit` hook. |
| `gitsignet init [--global]` | Write a sample config. |

The installed hook calls `gitsignet` if it's on `PATH`, else falls back to
`npx --no-install gitsignet`, so it works whether the tool is installed globally
or as a dev dependency.

## Exit codes

`check` and `doctor` exit `1` on a blocking condition (wrong identity, missing
identity, or a strict-mode violation) and `0` otherwise. Unknown commands exit `2`.

## How identity is resolved

`gitsignet` mirrors git's own precedence: `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`
environment variables override `git config user.name`/`user.email`. That's the
identity your next commit will actually carry — which is exactly what gets checked.

## License

MIT © flossy-studio
