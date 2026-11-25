---
name: dsh-superagent-mirror
description: Download, install or fetch anything slowly — reach for a mirror first, verify what arrived, and never sit on a stalled transfer.
---

A slow or stalled download is not something to wait out. In this environment it is the normal case, and the fix is
almost always a different source rather than more patience. Try a mirror before you try a longer timeout.

## The order to try

1. **The mirror you already know is fast.** For this machine that means a mainland mirror, not the primary host.
2. **A different registry or CDN** for the same artifact — same version, different origin.
3. **The primary source** with a longer timeout, only once the first two have failed.
4. **Ask the operator** with the exact URL and the exact error, when none of the above works.

## Mirrors worth trying first

| What | Mirror | Use |
| --- | --- | --- |
| npm / pnpm | `https://registry.npmmirror.com` | `npm i --registry=...`, `.npmrc` `registry=` |
| Node.js binaries | `https://npmmirror.com/mirrors/node/` | same layout as nodejs.org/dist |
| GitHub raw / releases | `https://ghproxy.net/https://github.com/...` or `https://ghfast.top/https://...` | prefix the original URL |
| PyPI | `https://pypi.tuna.tsinghua.edu.cn/simple` | `pip i -i ...` |
| Rust crates | `https://rsproxy.cn` | `~/.cargo/config.toml` `replace-with` |
| Go modules | `https://goproxy.cn` | `GOPROXY=...` |

Set it once for the whole job rather than per command when several installs follow — `.npmrc` in the working
directory, a `PIP_INDEX_URL` export — so a later step does not silently fall back to the slow origin.

## A stalled transfer looks like success

`curl` exits 0 on a truncated response often enough that the exit code proves nothing. A half-downloaded archive
unpacks with "unexpected end of file", or unpacks into a directory that is missing the file you needed. Check the
thing you downloaded, not the command that downloaded it:

- compare the byte count against `Content-Length` (or the size the mirror advertises)
- open it — `tar -tf`, `unzip -l` — and confirm the file you need is listed
- for a runtime, run `--version` on the extracted binary

## If it keeps failing

Say which mirror you tried, what it returned, and which one you want to try next. Do not report "the download
failed" without the URL and the error text — the operator cannot act on that, and the next attempt repeats it.
