---
name: other-memory-location
description: A second nestjs-backend-engineer memory directory exists at the repo root, with richer notes from the B1-B3 Social Suite packages (jest config fix, tsc baseline gotcha, RolesGuard usage, publisher patterns)
metadata:
  type: reference
---

This session's designated persistent-memory path is
`htownautos-backend/docs/social-suite/.claude/agent-memory/nestjs-backend-engineer/`
(empty until this package). A DIFFERENT, pre-existing memory directory for
the same agent role lives at the repo root:
`htownautos-backend/.claude/agent-memory/nestjs-backend-engineer/` — it has
a `MEMORY.md` index plus topic files including `jest-and-tsc-verification.md`
(root jest config was dead until 2026-09-23; `tsconfig.app.json` typechecks
ALL of `libs/**` not just imports — poisons naive baseline diffs) and
`social-suite-b3-patterns.md` (publisher package: Buffer/BodyInit TS
strictness, Google resumable-upload 308s, `FOR UPDATE SKIP LOCKED` claim
pattern). Worth reading before any future Social Suite package — it has
real, load-bearing gotchas not repeated here.
