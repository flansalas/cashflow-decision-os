# Project Brain Maintenance Protocol

## 1. Purpose
This protocol prevents the Cash Flow Decision OS project knowledge, status, and decisions from becoming dependent on AI conversational memory. It provides a persistent, human-verifiable, and machine-readable control record inside the repository. It governs approved product intent, recovery status, decisions, and open questions, while implementation reality must still be established from code, Git history, database evidence, tests, deployment evidence, and runtime behavior.

## 2. Read-Before-Work Rule
Before initiating any architecture, product, audit, recovery, or implementation task, agents must read the following files:
- [docs/project-brain/README.md](README.md)
- [docs/project-brain/CURRENT_STATE.md](CURRENT_STATE.md)
- [docs/project-brain/RECOVERY_STATUS.md](RECOVERY_STATUS.md)
- [docs/project-brain/OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)
- [docs/project-brain/DECISION_LEDGER.md](DECISION_LEDGER.md)

*Note: Reading these files does not replace reading the codebase, schema, and relevant technical documentation.*

## 3. Update Triggers
Project Brain updates should be proposed when:
- An audit or recovery phase is completed.
- A material fact is verified in the codebase or runtime.
- A human approves a product or architecture decision.
- An existing decision is superseded.
- A contradiction in documentation or code is identified.
- A blocker or next checkpoint changes.
- Deployment configurations, branch parameters, or canonical environments change.

## 4. Update Boundaries
- Agents may propose edits to the Project Brain.
- Agents may not silently convert findings or inferences into canonical decisions.
- No finding, state, or intent becomes canonical until human approval and a Git commit.
- Unknowns must remain marked as "Not yet verified" or "Unknown."
- Inferences or deductions must be explicitly labeled as such.
- Historical facts must not be rewritten merely because the current design has changed.
- Secrets, environment values, personal data, and credentials must never be stored in the Project Brain.

## 5. File Responsibilities
- [README.md](README.md): Defines authority models, epistemic categories, and operating rules.
- [CURRENT_STATE.md](CURRENT_STATE.md): Tracks the latest verified operational and technical state.
- [RECOVERY_STATUS.md](RECOVERY_STATUS.md): Maintains the current recovery phase, checkpoints, blockers, and next steps.
- [DECISION_LEDGER.md](DECISION_LEDGER.md): Stores human-approved decisions and their supersession history.
- [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md): Records unresolved questions, gaps, and contradictions.
- [MAINTENANCE_PROTOCOL.md](MAINTENANCE_PROTOCOL.md): Defines this maintenance process and rules of operation.

## 6. Phase Closeout Procedure
At the end of each audit or recovery phase, the following steps must be taken:
1. Produce the phase findings in the chat first.
2. Clearly separate confirmed facts, documented claims, assumptions, and unknowns.
3. Wait for the human to review the findings.
4. Update only the relevant Project Brain files to reflect the newly verified facts.
5. Show the exact diff of the proposed updates.
6. Obtain explicit human approval.
7. Commit the approved update as a separate commit.
8. Record the commit SHA in `RECOVERY_STATUS.md` at the next approved update.
9. Do not push unless explicitly instructed.

## 7. Decision Recording Rule
Decisions recorded in `DECISION_LEDGER.md` must follow this ID format:
`CFDOS-DEC-YYYY-NNN` (where `YYYY` is the year, and `NNN` is a sequential 3-digit number).

Each decision record must include:
- Date
- Exact decision
- Reason / Rationale
- Evidence / Code references
- Status
- Superseded decision (if any)
- Approving human

Allowed statuses:
- `Proposed`
- `Approved`
- `Superseded`
- `Rejected`
- `Deferred`

*Note: Approved decisions are active canonical decisions unless later superseded. Superseded decisions remain canonical historical records but no longer govern current product intent. Proposed, Rejected, and Deferred decisions are not canonical product intent.*

## 8. Handoff Rule
Before changing agent conversations, changing AI models, or swapping development tools, update `RECOVERY_STATUS.md` with:
- Current branch
- Latest relevant commit
- Completed phase
- Unresolved blockers
- Exact next action

## 9. Audit Integrity
- Implementation claims require repository code or runtime evidence.
- Product-intent claims require approved product documentation or explicit instructions.
- Documentation contradictions must be recorded in `OPEN_QUESTIONS.md` rather than resolved without human approval.
- Build success alone is not runtime verification.
- Audit tasks and implementation tasks must remain separate.

## 10. Minimalism Rule
The Project Brain must remain concise. Detailed audit evidence belongs in separate phase reports. The Project Brain is reserved only for controlling facts, decisions, status, and unresolved questions.
