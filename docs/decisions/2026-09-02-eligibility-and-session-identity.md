# Eligibility explanation and session identity

Date: 2026-09-02

Status: Documented; no production data change

## Eligibility explanation

FSY admission guidance should be explained from the participant date of birth, the session dates, and the current official policy rather than from a permanently hard-coded age label. The operations system therefore keeps the operational age range in session structure configuration and applies the existing shared eligibility rule consistently across grouping, assignment, check-in, and head count.

The current production session intentionally has a configured operational boundary of 13–20 for planning. That is an operational planning rule, not a claim that the application is the authoritative FSY admission policy. A future policy-aware implementation should derive the official rule from birth date and session dates, show the effective rule and source to an authorized operator, and place discrepancies in Age review without deleting or silently rewriting the source record.

Current official reference points include the [FSY Frequently Asked Questions](https://www.churchofjesuschrist.org/events/fsy/faq?lang=eng) and [FSY Local Leader Information](https://www.churchofjesuschrist.org/events/fsy/general-leader-info?lang=eng). The youth-protection page uses a broader policy context and should not be used alone as the admission eligibility rule.

## Session identity

The reusable application remains FSY Operations. Event-facing names belong in session configuration: the local rehearsal uses `KCC FSY 2026`, while the current production session reports `FSY Kumasi 2026`. Overview retains the supplied `Walk With Me · Moses 6:34` theme treatment as context and keeps the product identity visually separate from any official Church identity.

## Safety boundary

This decision does not change the production session name, age boundaries, participant records, or RLS policies. Any future policy change must be explicit, reviewable, and tested against the shared operational eligibility contract before it can affect assignments or day-of operations.
