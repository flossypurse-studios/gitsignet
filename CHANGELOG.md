# Changelog

## 0.1.3

- `doctor` now **warns about shadowed rules**. Because rules match first-wins,
  a broad rule (e.g. `github.com/*`) placed before a more specific one silently
  prevents the specific rule from ever firing. `doctor` now detects every later
  rule that also matches the current remote, lists them, and suggests reordering
  (most specific first). Purely diagnostic — it never changes the resolved
  identity or blocks a commit.

## 0.1.2

- Pre-commit hook now **fails open with a warning** when gitsignet is not
  installed (e.g. a fresh clone where nobody ran `npm i -g gitsignet`).
  Previously the `npx --no-install` fallback could error noisily and hard-block
  the commit with a confusing npm message. The hook now probes for a usable
  gitsignet first and, if none is found, prints a one-line notice to stderr and
  lets the commit proceed — a missing tool no longer blocks unrelated
  contributors.

## 0.1.1

- `fix [--global]` — new command that closes the loop: when the identity is
  wrong or unset for this remote, it applies the identity the matching rule
  expects by setting `user.name`/`user.email` (local, or global with
  `--global`). Idempotent, and refuses when no rule matches. The `doctor` and
  `check` mismatch hints now point to `gitsignet fix` instead of a manual
  `git config` command.

## 0.1.0

Initial release.

- `doctor` — zero-config diagnosis of the identity your next commit will use,
  the parsed remote, and the matching rule.
- `check [--hook]` — the guard: exits non-zero on a wrong / missing identity or a
  strict-mode violation.
- `install` / `uninstall` — manage the `pre-commit` guard (honours
  `core.hooksPath`, preserves an existing hook).
- `init [--global]` — write a sample config.
- Remote-aware rules keyed off `host/owner/repo` with `*`/`**` glob matching,
  named profiles, and a `strict` mode. Repo-local `.gitsignet.json` overrides a
  global config. Zero runtime dependencies.
