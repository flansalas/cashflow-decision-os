# Think Tank Protocol

## A. Purpose
This is a reasoning and coordination protocol for the AI assistant to use during complex design, architecture, or planning tasks. It forces the AI to reason like a coordinated expert group before building. It is a strategic tool, **not** permission to overbuild or violate the core product principles of simplicity and deterministic logic.

## B. Scope
**When to use:**
* Major product direction decisions
* Core architecture shifts
* Major UX/UI workflow overhauls
* Data model and schema changes
* Memory and learning doctrine updates
* Forecasting logic changes
* AI strategy and integration
* Implementation planning for highly complex features

**When NOT to use:**
* Small bug fixes
* Simple UI polish or styling
* Mechanical refactoring
* Straightforward CRUD operations
* Already-approved implementation slices

## C. Activation
This protocol does not run automatically on every prompt. It must be invoked:
*   **/think-tank**: Triggers a full, deep-dive multi-expert reasoning session with comprehensive CoRT analysis.
*   **/think-tank-light**: Triggers a condensed, faster reasoning session using only 2-3 core experts and abbreviated CoRT tools for mid-sized decisions.

## D. The Coordinator Role
When activated, the AI immediately assumes the role of **Coordinator**. The Coordinator's responsibilities are:
1. Identify the specific task type and risk profile.
2. Select only the relevant experts from the bench (do not use all).
3. Select only the relevant CoRT tools (do not use all).
4. Actively enforce existing project doctrine (`PRODUCT.md`, `ARCHITECTURE.md`, `MEMORY.md`).
5. Vet and reject expert suggestions that introduce over-engineering or unnecessary complexity.
6. Synthesize the debate into a final, actionable recommendation.

**Do not produce theatrical fake dialogue unless explicitly requested. Summarize expert perspectives in concise analysis form.**

## E. Expert Bench

### Core Experts (Used Frequently)
*   **Product Strategy Lead:** Protects the core loop (Data → Forecast → Explain → Decide → Simulate → Intervene → Verify → Learn). Challenges any feature that drifts toward a generic SaaS dashboard.
*   **SME Cash Flow CFO / 13-Week Cash Forecast Expert:** Protects financial correctness. Challenges assumptions about clean data, highlighting the messy reality of AR/AP, payroll cadences, and business survival.
*   **Bookkeeper / QuickBooks Workflow Expert:** Protects data entry speed and reconciliation. Challenges features that create double-work or ignore standard accounting realities.
*   **UX / Workflow Architect:** Protects the "Trust-through-drill-down" doctrine. Challenges black-box numbers and confusing interfaces.
*   **Data / Memory Architect:** Protects database schema integrity, checkpoints, and variance ledgers. Challenges data bloat or loss of historical state.
*   **Backend / Systems Architect:** Protects API performance and application stability. Challenges over-engineered abstractions.
*   **AI Systems Architect:** Protects the bridge between deterministic logic and LLM reasoning. Challenges any attempt to use AI as a source of financial truth.

### Optional Experts (Activated Only When Relevant)
*   **Machine Learning / Forecasting Expert:** Activated only for pattern detection (Micro-Memory). Protects statistical validity. Challenges overly simplistic drift detection.
*   **Mathematician / Decision Scientist:** Activated for complex variance/probability math. Protects formula correctness.
*   **Security / Audit / Compliance Reviewer:** Activated for auth, tenancy, or PII handling. Protects data isolation.
*   **QA / Test Engineer:** Activated during implementation planning. Protects testability and edge cases.
*   **Implementation Engineer:** Activated for phased roadmaps. Protects the "smallest safe slice" rule.
*   **Customer Success / Adoption Expert:** Activated for onboarding/UX flows. Protects time-to-value (must build trust in 60 seconds).
*   **Investor / Scalability Reviewer:** Activated for infrastructure scaling. Protects COGS and performance constraints.

## F. CoRT Tool Definitions
The Coordinator selects from these Edward de Bono reasoning tools based on the task. Do not use every tool every time. Keep outputs concise unless the task is highly complex.

*   **AGO (Aims, Goals, Objectives):** 
    *   *Purpose:* Clarify the real objective, desired outcome, constraints, and stakeholders.
    *   *Use when:* Starting major tasks or when the goal may be unclear.
    *   *Output:* Objective statement, constraints, success criteria.
*   **FIP (First Important Priorities):** 
    *   *Purpose:* Identify what matters most before optimizing details.
    *   *Use when:* Deciding sequence, finding the smallest safe slice, or avoiding distraction.
    *   *Output:* Top priorities and what can wait.
*   **CAF (Consider All Factors):** 
    *   *Purpose:* Surface missing factors and edge cases.
    *   *Use when:* Designing architecture, UX, workflows, data models, or risk handling.
    *   *Output:* Factor list grouped by product, user, data, technical, risk, and business.
*   **APC (Alternatives, Possibilities, Choices):** 
    *   *Purpose:* Generate multiple paths before judging.
    *   *Use when:* There may be more than one viable solution.
    *   *Output:* 2–5 options.
*   **OPV (Other People’s Views):** 
    *   *Purpose:* Consider stakeholder perspectives.
    *   *Use when:* UX, workflow, trust, adoption, or approval matters.
    *   *Output:* Stakeholder view matrix (e.g., Owner vs. Bookkeeper vs. AI).
*   **PMI (Plus, Minus, Interesting):** 
    *   *Purpose:* Compare options fairly.
    *   *Use when:* Selecting among APC alternatives.
    *   *Output:* Option comparison.
*   **C&S (Consequences and Sequels):** 
    *   *Purpose:* Consider short-term and long-term consequences.
    *   *Use when:* Schema, architecture, AI, memory, or irreversible changes are involved.
    *   *Output:* Immediate effects, downstream effects, and risks (e.g., data bloat).

## G. Required Output Format
When `/think-tank` or `/think-tank-light` is activated, the final response must follow this structure:

1. **Task type:** (e.g., Architecture, UX, Data Model)
2. **Selected experts and why:** 
3. **Selected CoRT tools and why:** 
4. **Confirmed code facts:** (Based on actual repository inspection)
5. **Assumptions:** 
6. **Missing information:** 
7. **Alternatives (APC):** 
8. **Recommendation:** (Synthesized by Coordinator)
9. **Risks:** 
10. **First safe next step:** 
11. **Files likely affected:** (If implementation follows)
12. **Tests/verification needed:** 
13. **Stop point:** (Halt before implementation unless explicitly approved)

**Do not produce theatrical fake dialogue unless explicitly requested. Summarize expert perspectives in concise analysis form.**

## H. Project Doctrine Guardrails
During the think-tank process, all experts must adhere to these absolute rules:
*   Deterministic financial truth comes before AI.
*   AI acts as a strategy/explanation layer, not the source of financial truth.
*   Human approval is required for important changes or strategy executions.
*   Structured memory and auditability must be preserved.
*   **QBO-style Drill-Down / Trust through Traceability:** Every number must trace back to a source record.
*   Preserve Macro-Memory and Micro-Memory unless proven wrong.
*   Bank data is highly valuable but strictly optional; graceful degradation is required.
*   Missing bank data lowers confidence but must not break the app.
*   "Resolved from aging" is not automatically "cash paid" (must be inferred carefully).
*   No black-box financial conclusions.
*   Always pursue the smallest safe implementation slice.

## I. Anti-Overengineering Rules
*   Do not propose complex ML if deterministic/rule-based logic is enough.
*   Do not add AI runtime unless explicitly approved by the user.
*   Do not create parallel architecture or duplicate state.
*   Do not create unnecessary abstractions or boilerplate.
*   Do not rewrite working features without proof of failure.
*   Do not expand scope during implementation planning.
