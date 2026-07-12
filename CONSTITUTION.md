# Cash Flow Decision OS — Canonical Product Specification v1.0
**Status:** Approved canonical product authority 
**Purpose:** Reconcile the latest product vision, recovered 
implementation, and prior documentation into one authoritative product 
definition.

---

## 1. Product Purpose

Cash Flow Decision OS helps an SME owner see where cash is heading 
over the next 13 weeks, deliberately change that outcome, commit to a 
plan, update the plan as reality changes, compare expectations with 
actual results, and improve future decisions.

The forecast is not the product by itself.

The product is the recurring management loop:

**Reality → Forecast → Explain → Decide → Commit → Execute → Update → Compare → Learn → Repeat**

The application should help the owner answer:

1. How much cash will the company open each week with?
2. Which future week is at risk?
3. What is driving that result?
4. What can management move, change, delay, accelerate, or finance?
5. What is the current approved plan?
6. What changed since that plan was approved?
7. What actually happened?
8. What should change in the next forecast or decision?

---

## 2. Core Product Principle

Every feature must support at least one of these outcomes:

- **See** the future cash position.
- **Manage** the future through timing and commitments.
- **Commit** to a plan.
- **Update** the live forecast as reality changes.
- **Verify** what happened.
- **Learn** from the difference.

If a feature does not materially support one of these outcomes, it 
should be hidden, repositioned, deferred, or removed.

---

## 3. Primary User

### SME Owner

The primary user is an owner or senior operator who does not want to 
operate a finance system as an accountant.

The owner needs:

- A simple 13-week view.
- Clear beginning cash by week.
- A way to move AR and AP.
- A way to add recurring and one-time cash items.
- A way to understand the total impact.
- A way to commit to a plan.
- A way to update that plan during the week.
- A way to compare plan with reality.
- Plain-English explanations and recommendations.

### Supporting Users

Bookkeepers, consultants, and finance staff may need deeper access to:

- Source records.
- Import conflicts.
- Overrides.
- Audit history.
- Forecast assumptions.
- Data-quality exceptions.
- Customer and vendor behavior.
- Historical checkpoints.

The application should support both through progressive disclosure 
rather than requiring a complex formal mode switch.

---

## 4. Canonical Operating Model

### Step 1 — Establish Current Reality

The system updates the current financial picture using:

- Current bank balance.
- Cash adjustments.
- Updated AR.
- Updated AP.
- Recurring commitments.
- One-time inflows and outflows.
- Data-source freshness.
- Import and reconciliation status.

**Human responsibility**

- Provide or approve updated information.
- Resolve material import conflicts.
- Confirm current cash.

**Deterministic system responsibility**

- Preserve provenance.
- Prevent duplicates.
- Record changes.
- Recalculate the forecast.
- Maintain auditability.

**Output**

A trusted live forecast baseline.

---

### Step 2 — See the 13-Week Future

The primary Plan experience shows:

- A simple 13-week cash chart.
- Beginning cash balance for each week.
- Lowest projected cash point.
- Critical risk weeks.
- Expected, best, and worst cases where useful.
- Toggle to a detailed 13-week table.

The main owner-facing balance is the **beginning cash balance for each 
week**.

Ending cash remains necessary for calculation and drill-down, but the 
owner should primarily understand how much cash the company is 
expected to have when each week opens.

---

### Step 3 — Manage the Future

The owner changes expected cash timing through four areas:

#### Receivables

- Move expected collection dates.
- Mark invoices collected.
- Correct or exclude records.
- Review customer payment patterns.

#### Payables

- Move expected payment dates.
- Mark bills paid.
- Identify critical obligations.
- Review vendor flexibility.

#### Recurring Cash

- Manage payroll, rent, loans, subscriptions, and other recurring 
flows.
- Move specific occurrences.
- Preserve the recurring pattern separately from one occurrence.

#### One-Time Adjustments

- Add non-recurring inflows or outflows.
- Assign them to the appropriate week.
- Preserve reason, source, and audit trail.

Every valid change should update the live forecast immediately.

---

### Step 4 — See the Total Impact

The system combines:

- AR timing.
- AP timing.
- Recurring cash.
- One-time adjustments.
- Historical baseline behavior.
- Forecast assumptions.
- Approved management interventions.

The owner sees the effect on:

- Beginning cash by week.
- Lowest cash point.
- Risk weeks.
- Runway.
- Expected, best, and worst outcomes.

The product should distinguish between:

#### Organic Forecast

What is expected if management does nothing differently.

#### Managed Forecast

What is expected after management-approved actions and timing changes.

This distinction is more important than a generic scenario overlay.

---

### Step 5 — Decide and Approve

The owner reviews the current plan and approves it as a management 
baseline.

An approved plan preserves:

- Forecast version.
- Opening cash.
- AR timing.
- AP timing.
- Recurring and one-time items.
- Approved interventions.
- Expected weekly balances.
- Responsible people.
- Expected outcome.
- Approval timestamp.

The approved plan is a snapshot of management intent at a point in 
time.

It must not be silently overwritten.

---

### Step 6 — Execute and Update During the Week

The approved plan does not freeze the live forecast.

Reality may change during the week:

- A customer pays early or late.
- A vendor changes terms.
- A new inflow or outflow appears.
- Payroll changes.
- An intervention succeeds or fails.

The current forecast should update immediately.

The system must preserve the difference between:

- **Approved Plan:** The management baseline at a specific moment.
- **Current Forecast:** The latest live financial outlook.
- **Printed Report:** A communication artifact representing the 
approved plan as of a specific date and time.

If the owner wants the current forecast to become the new management 
baseline, the owner may approve a revised plan version.

The original approved plan remains preserved for accountability.

---

### Step 7 — Communicate the Plan

The owner can print or export the current approved plan.

The printed report is not the system of record.

It should communicate:

- As-of date and time.
- Approved forecast version.
- Key cash risks.
- Planned actions.
- Responsible people.
- Expected impact.
- Beginning cash by week.
- Relevant assumptions.

---

### Step 8 — Close and Roll the Week

At week close, the owner confirms:

- Actual ending bank balance.
- Relevant adjustments.
- Collections received.
- Payments made.
- Actions completed or missed.
- Material exceptions.

The system then:

- Preserves the completed approved plan.
- Records actual cash.
- Advances the 13-week horizon.
- Rolls recurring items.
- Carries unresolved AR and AP forward.
- Creates a forecast checkpoint.
- Calculates variance.

---

### Step 9 — Compare Plan With Reality

The owner should see:

- Approved plan versus actual.
- Current forecast versus actual where relevant.
- Planned AR collections versus actual.
- Planned AP payments versus actual.
- Planned actions versus completed actions.
- Expected action effect versus actual effect.
- Unmatched difference.

Variance should be grouped into understandable drivers:

- Delayed inflows.
- Deferred outflows.
- Unexpected inflows.
- Unexpected outflows.
- Incorrect timing assumptions.
- Data changes.
- Unexplained residual.

---

### Step 10 — Learn and Repeat

The system retains:

- Customer payment behavior.
- Vendor flexibility.
- Recurring amount variation.
- Forecast bias.
- Seasonal patterns.
- Repeated action outcomes.
- Management follow-through.
- Common variance causes.

The next forecast should improve through controlled, traceable 
assumption updates.

The system must never silently rewrite financial truth.

Material assumption changes must remain visible, explainable, and 
auditable.

---

## 5. Trust Model

Trust is a core product capability.

The application must make every meaningful number understandable and 
traceable.

### Trust Principle

Every important value should answer:

- What is this?
- Why is it this amount?
- What changed it?
- Where did it come from?
- Who changed it?
- When?
- Can I inspect the underlying detail?

### Progressive Drill-Down

A user should be able to move from summary to detail:

**Week beginning cash → inflows/outflows → customer/vendor → invoice/bill → source record → audit history**

The user must also be able to return to the original context without 
becoming lost.

### Navigation Context

Drill-down should preserve:

- Original week.
- Original page.
- Applied filters.
- Selected entity.
- Back path or breadcrumb.
- Side drawer or modal context where appropriate.

The product should behave more like a trusted accounting system than a 
disconnected dashboard.

---

## 6. Hidden CFO AI Layer

The AI is not another dashboard, a second forecast engine, or an 
autonomous decision-maker.

The AI is a **hidden CFO** continuously analyzing the deterministic 
system and its memory.

The AI:

- Observes.
- Explains.
- Analyzes.
- Recommends.

The owner decides.

### AI Inputs

The AI may use:

- Deterministic forecast.
- Forecast checkpoints.
- Approved plans.
- Revised plans.
- Actual results.
- Variance history.
- Customer behavior.
- Vendor behavior.
- Recurring patterns.
- One-time adjustments.
- Data-quality signals.
- Management action history.
- Audit history.

### AI Explanations

The AI should explain:

- Why a week changed.
- Why beginning cash differs from the prior projection.
- Why confidence is high or low.
- Which assumptions matter most.
- Which data may be incomplete or unreliable.
- Why actual results differed from the approved plan.

### AI Recommendations

Recommendations should consider the full 13-week horizon and use three 
practical action categories:

- **Pull:** Accelerate inflows.
- **Push:** Delay or renegotiate outflows.
- **Dip:** Use external or other people’s capital.

The AI may also recommend:

- Correcting assumptions.
- Resolving data-quality issues.
- Escalating customer collections.
- Negotiating with vendors.
- Reducing or delaying discretionary spending.
- Revising the approved plan.

### Recommendation Explainability

Every recommendation should show:

1. **Recommendation**
2. **Why**
3. **Evidence**
4. **Expected impact**
5. **Consequences across the 13 weeks**
6. **Confidence**
7. **Relevant assumptions**
8. **What could make the recommendation wrong**

### AI Restrictions

AI must not:

- Change accounting records without approval.
- Move AR or AP silently.
- Approve a plan.
- Execute payments.
- Alter assumptions invisibly.
- Present uncertain conclusions as facts.
- Hide its evidence.
- Replace deterministic calculations.

---

## 7. Deterministic System Boundary

The following remain deterministic:

- Opening cash.
- Beginning and ending weekly balances.
- AR and AP timing.
- Recurring schedules.
- One-time adjustments.
- Forecast calculations.
- Scenario arithmetic.
- Variance calculations.
- Import matching.
- Rollback eligibility.
- Plan versioning.
- Forecast checkpoints.
- Audit records.
- Week close and roll.
- Data-quality and confidence inputs.

The deterministic engine answers:

**What is happening?**

The AI answers:

**Why is it happening, what are the consequences, and what should 
management consider doing?**

---

## 8. Product Structure

### A. Plan

The default owner-facing experience.

Contains:

- 13-week chart.
- Beginning cash by week.
- Detailed table toggle.
- Lowest cash point.
- Risk weeks.
- Organic versus managed forecast.
- Current approved plan.
- Current live forecast.
- Unapproved changes since the latest approved plan.
- Access to drill-down and explanations.

### B. Weekly Review

Contains:

- Approved plan versus actual.
- Variance drivers.
- Unresolved items.
- Action performance.
- Week close and roll.
- Forecast checkpoint history.
- Learning signals.

### C. Manage Cash

Supporting areas:

- Receivables.
- Payables.
- Recurring cash.
- One-time adjustments.

These pages support the Plan and should not compete with it.

### D. Data Sources

Contains:

- AR uploads.
- AP uploads.
- Bank uploads.
- Staging.
- Conflict resolution.
- Data freshness.
- Import history.
- Safe rollback.

### E. Audit Log

Preserves:

- User changes.
- Imported changes.
- Overrides.
- Forecast versions.
- Plan approvals.
- Revised plan approvals.
- Week rolls.
- Rollbacks.
- Assumption changes.
- AI recommendations accepted or rejected.

### F. Settings and Setup

Contains:

- Company information.
- Opening cash.
- Payroll and major assumptions.
- Safety buffer.
- Organization settings.
- Forecast settings.
- Data-source status.

### G. Scenarios

A secondary what-if sandbox.

It must remain separate from the approved operating plan.

Scenario values must be visibly labeled as simulated and must never 
silently change the approved or live forecast.

---

## 9. Interface Direction

### Retain

- Main 13-week chart.
- Detailed 13-week table.
- AR/AP weekly grids.
- Recurring cash.
- One-time adjustments.
- Weekly Review.
- Execution plans.
- Revised plan versions.
- Week close and roll.
- Forecast checkpoints.
- Variance tracking.
- Audit log.
- Staged imports and rollback.
- Payment behavior memory.

### Reposition

- Scenario Builder into secondary navigation.
- Data Sources as a supporting module.
- Finance detail behind progressive disclosure.

### Hide or Remove From the Primary Experience

- Excess chart modes that do not improve owner decisions.
- Large Weekly Routine card.
- Duplicative action panels.
- Dashboard views that compete with the core Plan experience.

### Redesign

- What Moves the Needle.
- Variance explanation.
- Forecast confidence explanation.
- Settings.
- Action recommendations.
- Organic versus managed forecast.
- Approved plan versus live forecast.
- Beginning versus ending balance presentation.
- Drill-down and return navigation.

---

## 10. Memory Architecture

The product memory should preserve:

### Financial Memory

- Cash snapshots.
- AR and AP timing.
- Recurring behavior.
- One-time adjustments.
- Forecast versions.
- Forecast checkpoints.
- Approved plans.
- Revised plans.
- Actual results.

### Behavioral Memory

- Customer payment patterns.
- Vendor flexibility.
- Action outcomes.
- Management follow-through.
- Repeated forecast errors.
- Recurring variance causes.

### Decision Memory

- Recommendations shown.
- Recommendations accepted or rejected.
- Human rationale.
- Expected impact.
- Actual impact.
- Plan revisions.
- Approval history.

### Trust Memory

- Source provenance.
- Import history.
- Overrides.
- Data-quality warnings.
- Assumption changes.
- Audit events.

Memory must be:

- Traceable.
- Versioned.
- Explainable.
- Tenant-isolated.
- Human-reviewable.

---

## 11. Product Principles

1. The forecast is not the product; the decision loop is the product.
2. Beginning cash by week is the primary owner-facing mental model.
3. The live forecast changes with reality.
4. Approved plans are immutable snapshots unless superseded by an 
approved revision.
5. Printed reports communicate a plan but do not define system truth.
6. Every meaningful number must be explainable.
7. Drill-down must preserve context and provide a clear return path.
8. Deterministic calculations establish financial truth.
9. AI reasons from trusted memory and evidence.
10. AI recommends; the owner decides.
11. Supporting modules must serve the core loop.
12. Complexity should be progressively disclosed.
13. Auditability and provenance are product features.
14. Build success is not proof of runtime correctness.
15. No feature should weaken trust, clarity, or the weekly decision 
loop.

---

## 12. Out of Scope for the Current Product Phase

- Autonomous payment execution.
- Autonomous movement of AR or AP.
- Fully autonomous plan approval.
- Deep-learning forecast replacement.
- Complex Markov-chain forecasting.
- Full QBO direct sync.
- Broad managerial accounting platform integration.
- Fully autonomous financing strategy.
- Formal owner/bookkeeper mode switching unless later proven 
necessary.
- Excess dashboard customization.

---

## 13. Current Implementation Reconciliation

### Keep

- Deterministic forecast engine.
- AR/AP management.
- Recurring cash.
- One-time adjustments.
- Execution plans.
- Revised plan support.
- Week close and roll.
- Forecast checkpoints.
- Variance drivers.
- Payment observations.
- Safe imports.
- Rollback controls.
- Audit history.
- Scenario persistence.
- Multi-tenant foundation.

### Reposition

- Independent ledger pages.
- Scenario Builder.
- Data Sources.
- Weekly Routine card.
- Multiple chart modes.
- Action modules.

### Correct or Verify

- Beginning versus ending balance presentation.
- Organic versus managed forecast.
- Approved plan versus live forecast.
- Revised plan workflow.
- Scenario isolation.
- Forecast memory affecting assumptions.
- Closed-loop action verification.
- Trust drill-down.
- Return navigation.
- Documentation alignment.
- Tenant fallback behavior.
- Forecast version integrity.
- Recurring versus baseline duplicate risk.

### Complete

- Owner-facing plan-versus-actual report.
- Action accountability.
- Learning loop.
- Trust drill-down.
- Hidden CFO explanations.
- Hidden CFO recommendations.
- Controlled assumption updating.
- Canonical documentation.

### Defer

- Autonomous execution.
- QBO sync.
- Deep-learning forecasting.
- Broader managerial accounting platform.

---

## 14. Next Phase

The next phase is **Product Reconciliation Mapping**.

The repository should be compared against this specification and every 
major element classified as:

- Keep as is.
- Keep and reposition.
- Correct.
- Complete.
- Hide.
- Remove.
- Defer.

That mapping should then produce the implementation roadmap and the 
next release slices.

No new feature implementation should begin until this specification is 
accepted as canonical product authority and the reconciliation map is 
approved.
