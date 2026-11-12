---
name: dsh-superagent-docs
description: Write or correct documentation that matches the code — every imperative and every version number traceable to something that exists.
---

Documentation goes wrong the same way every time: it describes what the software was meant to do rather than what it
does.

## The rule

Every command, button, option and version number in a document must be traceable to something in the code or in a file
that exists. If you cannot point at the implementation, do not write the instruction.

Check by searching rather than by memory:

- a named command — find where it is registered
- a configuration key — find its schema
- a claim about behaviour — find the branch that does it
- a version range — run the range against the versions it claims to support

A claim that survives the search belongs in the document. One that does not is a plan wearing the clothes of a fact —
delete it, or move it somewhere explicitly labelled as planned.

## Say what is not there

A section listing what the software does **not** do is worth more than another promise. A reader who knows the gaps does
not file a bug against a limitation that was never going to work.

## Ratings and compatibility claims

If a table has a column of scores, stars or "supported" marks, that column is a claim. Either every row has evidence
behind it, or the row says it has none. A footnote that says "these ratings are targets, not measurements" does not fix
a row that reads as a measurement — the reader scans the column and moves on.

## Keep the translations in step

When a document exists in several languages, a change to one is a change to all of them. Reordering a table in one and
not the others produces a document set that contradicts itself, which is harder to trust than a document that is simply
out of date.
