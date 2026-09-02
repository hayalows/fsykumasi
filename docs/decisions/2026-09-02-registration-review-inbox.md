# Registration review inbox

Date: 2026-09-02

## Decision

Registration exceptions are presented as named review queues rather than anonymous counters. The review inbox separates Awaiting approval, Age review, Needs verification, Ready but unassigned, Missing ward/branch, Missing from latest export, and Cancelled records.

The headline counts unique people so overlapping issues do not inflate the number of people needing attention. Queue counts may overlap because a single record can legitimately need more than one type of review.

## Operational rules

- Awaiting and Cancelled source records remain visible but are excluded from grouping, check-in and head count.
- Official registration snapshots remain authoritative for approval/cancellation changes.
- Age-review records remain preserved but are excluded from youth operations until source data or the session age rule is intentionally corrected.
- Ready but unassigned contains only participants who pass the shared operational-eligibility rule.
- On-site verification can be resolved from the review inbox by leaders with verification permission.
- Eligible unassigned participants can be assigned to a compatible counselor group from the review inbox.
- Original registration full name is always the primary displayed identity; preferred name is secondary context only.
- Restricted registration details are loaded only for administrators through the existing RLS-protected private-detail table.

## UX approach

The Registration page now has two top-level modes: Registration and Review inbox. The older counter-only Data quality tab is hidden to avoid presenting two competing review experiences. On small screens the queue cards scroll horizontally and the selected person opens as a bottom-sheet-style detail panel.
