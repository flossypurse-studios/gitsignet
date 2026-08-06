# Changelog

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
