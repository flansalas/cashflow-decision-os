# Project Brain — Cash Flow Decision OS

## Purpose
The Project Brain is the canonical control record for human-approved product intent, recovery status, decisions, and open questions. It is not a substitute for repository code, Git history, database evidence, tests, or runtime behavior when determining implementation reality.

## Authority Models

### A. Product Intent Authority
This model determines what the product is *intended* to do. It guides specifications, requirements, and verification:
1. **Human-approved and committed Project Brain decisions/specifications:** The highest authority on the product definition.
2. **Explicit current human instruction:** Active guidance provided by the operator.
3. **Other approved product documentation:** Core product documents such as `PRODUCT.md`.
4. **Historical documentation and conversation claims:** Legacy plans, roadmap drafts, and conversational context.

*Note: Current code does not automatically override approved product intent. The codebase may reveal that product intent has not been fully implemented or has drifted over time.*

### B. Implementation Reality Evidence
This model tracks what actually exists and runs. It guides implementation recovery, debugging, and gap analysis:
1. **Verified runtime behavior:** What the system does when executed, tested, or run.
2. **Repository code and database schema:** The physical implementation source files.
3. **Git history:** Commit logs, branches, and version history.
4. **Tests and verification evidence:** Automated and manual test scripts.
5. **Deployment configuration:** Package manifest, configuration settings, and server environment setups.
6. **Documentation and agent claims:** Stated code architecture descriptions or mental models.

*Note: Implementation evidence describes what exists. It does not by itself determine what the product should become.*

## File Structure
- [README.md](README.md): Purpose, authority models, structure description, and operating rules.
- [CURRENT_STATE.md](CURRENT_STATE.md): Current technical state, deployments, and known verified facts.
- [DECISION_LEDGER.md](DECISION_LEDGER.md): Historical record of architecture, design, and product decisions.
- [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md): Tracked open questions categorized by domain.
- [RECOVERY_STATUS.md](RECOVERY_STATUS.md): Current audit phase, completed checkpoints, active branch, and next steps.

## Operating Rules
1. **Human Review Required:** A Project Brain entry becomes canonical only after human approval and Git commit.
2. **Update Protocols:** Audit agents may propose updates but may not silently convert findings into canonical decisions.
3. **Contradiction Management:** Contradictions must be recorded rather than resolved without human approval.
4. **Epistemic Status:** Agents must explicitly distinguish between:
   - **Confirmed fact:** Directly verified in the codebase, Git history, or runtime environment.
   - **Documented claim:** Stated in documentation, comments, or external specifications but not yet verified.
   - **Assumption or inference:** Logic deduced from existing facts or claims but not explicitly confirmed.
   - **Unknown:** Missing or unverified information.
