---
name: dsh-superagent-code-navigation
description: Navigate, search, read, and edit codebases with high precision — parallel search batching, read-before-edit grounding, lockfile toolchain detection, and bounded lint/type repair loops.
---

Ground every code claim and every edit in opened source files rather than assumptions.

## Single Source of Truth

1. **Never speculate about unopened files.** Always read the target file or line range before explaining its logic or modifying it.
2. **Batch independent searches and reads in parallel.** Issue non-dependent `grep`, `glob`, and `read` calls in the same step instead of serializing one lookup per turn.
3. **Prefer structured search tools over recursive shell scans.** Use `grep` (exact symbols/regex) and `glob` (file patterns) rather than `grep -R` or `find` in shell commands, which ignore `.gitignore` and stall on `node_modules` or build artifacts.
4. **Trace callers and references before changing shared interfaces.** When altering a function signature, schema, or exported type, search all call sites across `src/` and `tests/` first.

## Safe Code Modification

1. **Detect toolchains and libraries strictly from manifests and lockfiles.** Check `package.json`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.toml`, `pyproject.toml`, or `go.mod` before assuming a library or runner is installed. Never hand-edit lockfiles.
2. **Match surrounding conventions.** Follow the file's existing indentation, quote style, import ordering (top-of-file imports only), error handling, and naming patterns.
3. **Prefer targeted edits on existing files** over creating unrequested new files or redundant markdown summaries.
4. **Bound repair loops.** If an edit introduces type or lint errors, read the exact compiler/linter diagnostic and fix the root cause. Do not guess blindly or loop more than 3 times on the same error without re-evaluating the approach.
