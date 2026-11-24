---
name: dsh-superagent-diagnostics
description: Diagnose broken plugins, MCP servers, skills, hooks, and CLI shims systematically — registration checkpoints, schema validation, Windows shim pitfalls, and isolated reproduction.
---

When a plugin, tool, skill, or command is installed but fails to appear or execute, inspect each registration boundary in order instead of guessing.

## The Four Plugin & Tool Registration Checkpoints

1. **Build output & entry file:** Confirm the compiled entry (`lib/index.js` or configured `main`/`exports` target) exists on disk and exports the expected module format (ESM vs CJS).
2. **`package.json` manifest & exports:** Verify `exports`, `peerDependencies`, and host metadata fields match the host version.
3. **Host mount / patch configuration:** Confirm the plugin or preset entry is mounted in `cordis.patch.yml` (or MCP config) with any required `isolate` scope and `disabled: false`.
4. **Runtime health & logs:** Read actual startup diagnostics and error stacks rather than assuming silent success.

## Skills, Hooks, and Cross-Platform CLI Shims

- **Skills (`SKILL.md`):** Check YAML frontmatter (`name` lowercase hyphenated, non-empty `description`), UTF-8/LF encoding, and discovery root configuration (`DSH_BUNDLED_SKILL_DIR`, `.agents/skills`, or profile skill directories).
- **Windows CLI shims (`.cmd` / `.ps1`):** `npm`, `npx`, `pnpm`, and `yarn` on Windows use `.cmd` wrappers that fail with `EINVAL` when spawned directly without shell resolution; invoke through the platform shell or direct `.mjs`/`.js` entrypoints.
- **Isolated verification:** Always test repairs in a temporary profile or isolated state directory so existing user credentials and live ports remain untouched.
