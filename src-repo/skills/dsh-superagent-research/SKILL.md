---
name: dsh-superagent-research
description: Answer a question that needs reading the web or a codebase — search, read the actual source, separate what was verified from what was assumed.
---

A research deliverable is an answer someone can act on, with the evidence attached. It is not a list of search results.

## Order of work

1. **Read what is authoritative first.** A repository's own source, its `package.json`, its docs — before a blog post
   about them. A version's release notes before a summary of the release notes.
2. **Search to find the source, then read the source.** A search result is a signpost. Fetch the page and read it; a
   snippet is regularly wrong about detail that matters.
3. **Prefer the exact artifact.** If the question is "does this support X", find the line that implements X or the
   changelog entry that adds it. "The documentation mentions X" is weaker than "this file handles X".

## Writing it up

- Lead with the answer, then the evidence. Someone scanning the first two lines should get the conclusion.
- Separate **verified** from **assumed** explicitly. A sentence you inferred and a sentence you read are not the same
  thing, and the reader cannot tell unless you say so.
- Quote the thing you rely on — a line of code, a version number, a changelog entry — and say where it came from.
- When the evidence does not settle the question, say that. A bounded "these two versions differ in X, I could not
  determine which one your install has" is more useful than a confident guess.

## Do not

Do not fill a gap with plausible-sounding detail. A wrong number in a research report costs more than an admitted gap,
because the reader acts on it.
