---
name: Running on Windows
description: Two pnpm-workspace traps that stop the frontend running on Windows.
---

Two things in this repo block a local Windows run. Both were hit and fixed on
2026-10-08.

**1. Platform binaries were excluded.** `pnpm-workspace.yaml` `overrides`
excludes every non-Linux native binary because Replit is linux-x64. That means
`vite` dies with `Cannot find module @rollup/rollup-win32-x64-msvc`. The
win32-x64 entries for `rollup`, `esbuild`, `lightningcss` and
`@tailwindcss/oxide` have been removed from the exclusion list. Linux installs
are unaffected — they are platform-selected optional deps that Linux skips
anyway — so do not "tidy" them back in.

**2. The `preinstall` guard breaks nested installs.** The root `preinstall`
script rejects anything where `$npm_config_user_agent` is not `pnpm/*`. When
`pnpm --filter <pkg> run <script>` does its implicit deps-status check it
re-invokes install without that variable, so the guard fails and the script
never runs. Workaround: call the binary directly, e.g.
`artifacts/whatsapp-clone/node_modules/.bin/vite` or
`node_modules/.bin/tsc -p artifacts/whatsapp-clone/tsconfig.json --noEmit`.

**Also:** Git Bash rewrites a lone `/` in an env var into the Git install path,
so `BASE_PATH=/ vite` silently becomes `BASE_PATH=C:/Program Files/Git/`.
Launch Vite from PowerShell on Windows, or set `BASE_PATH` some other way.

**Why:** none of this is visible from the code; each one costs a confusing
failure to rediscover. See [[whatsapp-clone-scope]].
