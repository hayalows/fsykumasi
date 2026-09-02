# FSY Kumasi registration data and operations

This document records the privacy-safe conclusions and operating process for the FSY Kumasi 2026 registration export. It intentionally contains no names, contact details, dates of birth, medical notes, emergency contacts, or other row-level registration data. Raw exports must never be committed to this repository.

## What the current export taught us

The inspected export contains 1,929 records across 24 columns: 1,664 youth participants and 265 YSA counselors. It mixes both populations in one file, so an importer that assumes every row is a youth participant is unsafe. Registration status is operationally important: 1,852 records are approved, 60 await approval, and 17 are cancelled.

There is no durable registration identifier column. Email and phone cannot substitute for one because households share them. Name plus birthday also has legitimate collisions. The combination of person type, normalized full name, birthday, unit, and registration timestamp was collision-free in the inspected file. The browser hashes that material into an opaque source record key before upload; the source identity material itself is not stored as an identifier.

Birthday values use ISO `YYYY-MM-DD`. Thirty-six approved youth celebrate a birthday during 14–19 September 2026. The system matches month and day regardless of birth year and calculates the age the participant turns in 2026.

The export also contains private contact, emergency, medical, dietary, and ecclesiastical fields. Those fields are stored separately from the broadly readable operational people record. General operational screens use only the minimum fields needed for search, grouping, check-in, and exception resolution.

## Applying a later export

1. Export the complete current registration file. Do not edit the previous file in place.
2. In **Registration operations → Import snapshot**, choose the complete CSV or workbook.
3. Review youth/counselor/status totals, birthdays, blocking errors, and warnings.
4. Apply only when the fingerprint and counts match the intended file.
5. The database updates matching opaque source keys and adds new people in one transaction.
6. Imported people omitted from the later snapshot are reconciled:
   - unassigned and not checked in: made inactive and marked omitted;
   - already assigned or checked in: kept operational and surfaced as `missing_from_latest` for human review.
7. On-site records are never removed or changed by snapshot replacement.

Applying the exact same file twice is rejected by its SHA-256 fingerprint. A failed row aborts the entire transaction; there is no partial import.

## Day-of addition

The intended flow is: search first → add on-site → pending verification → access administrator verifies → assign to a compatible group → check in. A pending or rejected on-site record cannot be assigned or checked in. Every creation, verification decision, assignment, and check-in is audit recorded.

## Eligibility rules

Only people who are current, approved, and verified count as operational youth. Awaiting, cancelled, omitted, or pending-verification records remain visible to authorized leaders as data-quality exceptions but do not enter grouping, check-in totals, or head counts.

## Access override decision

A Coordinator remains displayed as Coordinator. A Logistics Administrator or Session Directing Couple may grant that specific assignment the `access_admin` capability. It can be revoked and is audit recorded. The capability grants access-management and full administrative behavior, but only a true Logistics Administrator or Session Directing Couple can grant or revoke the capability, preventing delegated administrators from expanding the override to others.

## Privacy-safe profiling

Run the aggregate-only profiler locally:

```powershell
python scripts/profile-registration-data.py "C:\path\to\registration.csv"
```

The script suppresses row values for sensitive columns and reports only counts, categories, collision totals, date quality, and birthday distributions. Do not redirect its output into the repository unless it has been reviewed for privacy.
