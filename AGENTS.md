# CashFlowDecision OS — Agent Operating Protocol

## Project Doctrine
- Before implementing, read PRODUCT.md and ARCHITECTURE.md.
- Compare every task against the core loop: Data → Forecast → Explain → Decide → Simulate → Intervene → Verify → Learn
- Preserve the principle: The forecast is not the product. The weekly cash decision loop is the product.
- Prefer the smallest safe implementation.
- Do not create generic SaaS dashboard features unless they directly support the weekly cash decision loop.
- For any roadmap or architecture recommendation, inspect the actual repo first and clearly separate current code reality from product vision.

## Project Brain — Required Recovery Context

Before any product, architecture, audit, recovery, implementation, or verification task, agents must read:
- docs/project-brain/README.md
- docs/project-brain/CURRENT_STATE.md
- docs/project-brain/RECOVERY_STATUS.md
- docs/project-brain/OPEN_QUESTIONS.md
- docs/project-brain/DECISION_LEDGER.md
- docs/project-brain/MAINTENANCE_PROTOCOL.md

- The Project Brain governs human-approved product intent, recovery control, decisions, and open questions.
- It does not replace repository code, schema, Git history, tests, deployment evidence, or runtime behavior when determining implementation reality.
- Agents may propose Project Brain changes but must follow docs/project-brain/MAINTENANCE_PROTOCOL.md.
- Agents must not silently resolve contradictions or convert audit findings into canonical decisions.
- Audit work and implementation work must remain separate unless the human explicitly starts a new implementation task.

This protocol is mandatory for all AI agent work on the CashFlowDecision OS project.

## 1. Canonical Repository

The real git-connected repository is:

`/Users/flans/CashFlowDecision OS copy/app`

Before any implementation, terminal work, commit, or push, confirm:

- `pwd`
- `git rev-parse --show-toplevel`
- `git branch --show-current`
- `git status --short`
- `git remote -v`

If the agent is not inside the canonical repo, stop immediately and report the mismatch.

All git commands must be run from:

`/Users/flans/CashFlowDecision OS copy/app`

Never run git commands from the parent folder:

`/Users/flans/CashFlowDecision OS copy`

---

## 2. Mandatory Work Modes

Every task must operate under one of these modes:

### AUDIT MODE — NO CODE CHANGES
Allowed:
- inspect files
- search code
- explain current behavior
- diagnose likely causes

Not allowed:
- edit files
- commit
- push

### DESIGN MODE — NO IMPLEMENTATION
Allowed:
- propose architecture
- propose implementation plan
- identify files likely needed
- define acceptance criteria
- execute THINK_TANK_PROTOCOL.md reasoning before planning when activated via /think-tank or /think-tank-light

Not allowed:
- edit files
- commit
- push

### APPROVE IMPLEMENTATION
Allowed:
- edit only the explicitly approved files
- make only the approved change

Not allowed:
- touch extra files without stopping and asking
- commit
- push

### APPROVE COMMIT AND PUSH
Allowed:
- stage only explicitly approved files
- commit with approved message
- push to `origin main`

Not allowed:
- use `git add .`
- include unapproved files
- continue to another task after pushing

---

## 3. Approval Gates

Never edit files unless the user explicitly says:

`APPROVE IMPLEMENTATION`

Never commit or push unless the user explicitly says:

`APPROVE COMMIT AND PUSH`

Never auto-continue from:
- audit to implementation
- design to implementation
- implementation to commit
- commit to another task

If extra files are required, stop and ask before editing.

---

## 4. Before Editing

Before making code changes, the agent must state:

- exact files to modify
- exact changes to make
- why each change is needed
- whether production behavior changes
- whether any dependency files are required

If the task involves financial logic, forecast logic, cash totals, AR/AP, exclusions, overrides, or backlog behavior, first trace the relevant data flow before editing.

---

## 5. Implementation Rules

Use the smallest safe slice.

Do not:
- refactor unrelated code
- redesign unrelated UI
- change production behavior outside the approved scope
- touch unrelated files
- silently fix other issues
- broaden the scope without permission

For visible UI changes:
- preserve the existing structure unless a redesign is explicitly approved
- improve clarity only within the approved scope
- avoid unnecessary visual redesigns

For financial logic:
- preserve consistency between dashboard totals, forecast totals, AR/AP grid totals, and excluded-item handling
- do not allow UI display totals to diverge from server-side forecast logic

---

## 6. Verification

After implementation, run the appropriate check:

- `npm run build`

or, if explicitly agreed for a smaller slice:

- `npx tsc --noEmit`

If build/typecheck fails, report:
- the exact error
- whether it is related to the approved change
- the smallest proposed fix

Do not continue fixing unless approved.

---

## 7. Git Safety

Never run:

`git add .`

Only stage explicitly approved files.

Before commit, perform a pre-commit audit:

- list all modified/untracked files
- label each file: KEEP / REMOVE / UNSURE
- propose exact commit message
- confirm no unapproved files will be included

After push, report:

- exact commands run
- new commit hash
- push success
- branch pushed to `origin/main`

Then stop and wait.

---

## 8. Current Product Direction

CashFlowDecision OS is moving toward:

`simulate → intervene → verify`

Current priorities:
- preserve production stability
- protect financial correctness
- improve trust and explainability
- validate with tester feedback before overbuilding
- avoid unnecessary complexity

Do not implement Markov/probabilistic architecture now.

Use:
- lightweight explicit state
- simulation-backed action logic
- clear trust signals
- narrow, testable slices

---

## 9. Stop Conditions

Stop immediately if:

- repo path is wrong
- git status shows unexpected files
- extra files are required
- build/typecheck fails
- a change could affect production behavior outside approved scope
- the agent is unsure whether the change belongs in the current slice

---

## 10. Memory Maintenance

- `MEMORY.md` is the living project save state.
- Before any implementation, read `PRODUCT.md`, `ARCHITECTURE.md`, and `MEMORY.md`.
- `PRODUCT.md` is stable product doctrine and should change only when product vision, ICP, principles, or anti-goals change.
- `ARCHITECTURE.md` documents current technical reality and should change only when architecture, data models, routes, or major system boundaries change.
- `MEMORY.md` should be updated when meaningful implementation work changes product state, current gaps, active focus, roadmap, risks, or the next safest implementation slice.
- Do not update `MEMORY.md` for typo fixes, minor styling tweaks, aborted work, reverted work, or changes that do not affect product state or roadmap.
- When a meaningful implementation is completed and verified, update `MEMORY.md` before the commit so the code change and memory update can be committed together.
- Keep `MEMORY.md` short, current, and operational. Do not use it as a long-term idea dump.
- Keep `AGENTS.md` and `GEMINI.md` synchronized. If one changes, apply the same change to the other in the same commit.
- Always separate current code reality from product vision and future plans.
