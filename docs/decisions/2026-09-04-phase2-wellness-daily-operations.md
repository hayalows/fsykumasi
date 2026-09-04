# Phase 2 Wellness and Daily Operations decisions

Date: 2026-09-04
Status: released through PR #36, with the read-only Food RPC ordering correction in PR #37

## Experience model

- Wellness is a queue, not a form-first archive: search a person, start one active visit, keep the queue visible, then check out with an explicit terminal outcome.
- A person can have many historical visits, but only one active visit per session/person. Follow-up is a separate open/resolved state and is never inferred from a generic closed status.
- Status-only operators see the operational queue and outcome timing without private concerns, care, medicine, notes, or recorder identity. Private Wellness users can open the detail sheet.
- Food separates meal attendance from dietary needs. A date and meal type identify a service; attendance is recorded once per person with immediate local feedback and a server timestamp.
- Head Count keeps the fast company-first action as the primary path. Alternate totals and person-level reconciliation are disclosed only after opening a company. Head-count statuses are operational facts and do not copy or reinterpret Wellness status.

## Schema and concurrency

- `headcount_person_statuses` stores optional per-person reasons with `unique(round_id, participant_id)`. `submit_company_headcount_v2` locks the round, recalculates the expected company count, writes the submission and reconciliation statuses in one transaction, and records an audit event.
- `get_headcount_workspace` returns rounds, scoped companies, server expected counts, minimal expected people, submissions, and statuses in one guarded read. The existing submit RPC remains compatible and now uses the same server denominator.
- `wellness_encounters` gains `follow_up_status` and resolution metadata. Partial unique indexes prevent concurrent active participant/staff visits. Checkout locks the row, rejects a second checkout, records `closed_at` on the server, and opens follow-up only for the explicit follow-up outcome.
- `meal_services` is unique by session/date/meal type. `meal_attendance` has separate partial unique indexes for participant and staff attendance. `mark_meal_served` locks the service and treats a repeated request as idempotent without a second audit record.
- New operational tables have RLS enabled and no direct authenticated grants. Reads and writes go through capability-checked security-definer RPCs with an empty search path and explicit authenticated execute grants.

## Data and release boundaries

- Existing production records are not seeded or rewritten. The only deterministic data migration is backfilling `follow_up_status = open` for existing `follow_up_needed` visits; resolved follow-ups remain resolved.
- The shared eligibility function is aligned with the live date-of-birth, session-window, verification, current-record, attendance, and badge rules. The expected-right-now head-count helper excludes confirmed non-attendance, ineligible records, and retired-only badges while allowing current replacement records.
- The app keeps Navii avatar seeds on stable user IDs only. Raw emails are not used as avatar seeds or exposed by the new workflows.
- The product remains reusable: the session-facing name comes from session configuration (`KCC FSY 2026` in the rehearsal), while the Overview theme treatment retains `Walk With Me · Moses 6:34`.
- Reporting 2.0, exports beyond existing capabilities, and new realtime publication changes remain intentionally deferred to Phase 3.
