# Changelog

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
