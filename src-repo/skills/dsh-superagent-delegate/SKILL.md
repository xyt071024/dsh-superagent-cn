---
name: dsh-superagent-delegate
description: Split work across subagents when one Session cannot do it alone — how to write the brief, what to hand off, and how to verify what comes back.
---

A subagent is a fresh Session with its own window. Use one when the work splits along a boundary that does not need your
context, not to get a second opinion on something you can decide.

## When it pays

- Several files or several domains, independent of each other
- A long, self-contained investigation whose intermediate steps you do not need to see
- Work that would exhaust your own window before it finished

## When it does not

One tightly coupled change, or anything where the child would need most of your context to start. Handing off and then
re-explaining everything costs more than doing it.

## The brief

A subagent does not inherit your conversation. Its prompt has to stand alone:

1. **The goal**, stated as an outcome, not a topic.
2. **The exact files or directories it may change**, and what it must not touch.
3. **The facts it should assume** — spelled out, because it cannot look them up the way you did.
4. **How its work will be judged**, as something checkable.

An ambiguous brief comes back as plausible work in the wrong place, which is worse than no work.

## What comes back

Treat a child's report as a claim, not a result. Verify anything you will act on, and be especially careful with a
negative claim — "there is no code for X" is the claim most often made from too little reading. Before repeating it,
search for it yourself.

Two children writing the same file will produce two versions of it. Keep their write scopes disjoint, and merge the
results yourself.
