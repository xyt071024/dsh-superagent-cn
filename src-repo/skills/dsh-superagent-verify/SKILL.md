---
name: dsh-superagent-verify
description: Prove the work before reporting it — the checks that catch a change which looks finished and is not.
---

An assignment is finished when the result has been observed, not when the edit has been made.

## The two checks that catch most of it

**Types and tests are different gates.** A test runner compiles without type checking, so a green suite can sit on top
of a file that will not build. Run both, and judge the type check by counting its errors rather than by its exit code —
some configurations exit zero with errors printed.

**Compare against a baseline taken before you changed anything.** Collect the failing set first, then after, and diff
the two. A suite that was already partly red will drown a real regression otherwise, and a run that collects its baseline
mid-change will invent failures that never existed.

## What "verified" means for each kind of deliverable

| Deliverable | Evidence |
| --- | --- |
| Code change | the command you ran and its output, not a claim that it works |
| Fix for a report | the reproduction failing before, passing after |
| Document | someone following it would get the same result; every command it gives was run |
| Install | the installed thing executed once, from the same shell the user will use |
| Package or archive | unpacked on the target platform and opened, not just built |

## The failure modes worth naming

- **Passing because nothing ran.** A test file that failed to load reports zero failures. Check the count is what you
  expect.
- **Passing on this machine only.** A path, a separator, a shell or a permission that exists here and not on the user's
  machine. Unpack the artifact and try it there.
- **Passing for the wrong reason.** A test that passes because the feature was skipped. Read the skip list.

## Reporting

Say what you ran and what it printed. When part of it is unverified, say which part — an honest "the unit tests pass, I
could not run it under the real host" is usable; a flat "done" is not.
