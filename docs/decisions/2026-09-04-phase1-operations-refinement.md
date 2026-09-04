# Phase 1 operations refinement

Date: 2026-09-04
Scope: mobile-first operations UI, authentication lifecycle continuity, arrival reconciliation boundaries, and public-release hygiene

## Decision

Make the next operational action obvious at the point of use, and move lower-frequency or higher-risk actions behind an explicit disclosure. Keep the source registration record, identity foundation, permissions, and operational rules authoritative in the backend. The UI may simplify the path, but it must not silently change meaning or authority.

## Information architecture

The persistent task navigation is:

- Today: Overview, Check-in, Head count, Groups & companies.
- More: People & setup (People, Registration, Assignments); Team tools (Housing, Wellness, Food, Reports); Admin & utilities (Access, Birthdays).
- Account: opened from the profile identity entry, not a permanent task destination.

The mobile bottom bar keeps the four Today actions and a More action. More opens a drawer rather than competing with the primary task bar. The drawer closes on backdrop tap, Escape, explicit close, and navigation; it locks background scrolling and restores focus to the opener.

## Disclosure and touch rules

Search is placed before large result sets. A list row opens a detail surface, and secondary or sensitive information is disclosed only when needed. Buttons, tabs, inputs, and drawer rows use at least a 44px interaction height. Important labels do not rely on hover, and reduced-motion users do not receive decorative transitions.

Account begins with a compact identity summary. Edit name, permissions detail, and password security are separate disclosures. Sign-out is a compact action. Navii avatar seeds use only a stable user ID or a fixed demo seed; raw emails never enter the avatar seed.

People remains a search-first directory. Age and sex are grouped, registration and assignment context is progressive, and mobile detail uses a bottom sheet. Confirmed non-attendance is a consequential action: it requires an explicit authorized source and optional note, preserves the original participant, and uses the guarded arrival-status path.

FSY ID preparation is a preview/draft step. Finalization is an admin-only disclosure with an explicit confirmation sheet; there is no automatic production finalization.

## Backend and release boundary

The Phase 1 migration `20260904092550_phase1_arrival_scope_hardening.sql`:

1. delegates the legacy attendance RPC to `set_participant_arrival_status`, so older callers inherit checked-in/no-show validation and audit behavior;
2. adds the missing Assistant Coordinator company-scope predicate to `get_arrival_vacancies`;
3. changes no table, row, data, or RLS policy.

The public branch excludes `AGENTS.md`, `.env*`, credentials, secrets, and local-only artifacts. The browser keeps only the Supabase publishable key; service-role access remains server-side and is not part of the client bundle.

## Evidence and references

- Local rehearsal evidence: `docs/audits/2026-09-04-phase1-operations-ui-ux.md`.
- Apple Human Interface Guidelines: [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars), and [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets).
- Supabase guidance: [database security](https://supabase.com/docs/guides/database/overview) and [auth session management](https://supabase.com/docs/guides/auth/sessions).
- FSY planning context: [2019 FSY Planning Guide](https://www.churchofjesuschrist.org/youth/fsy/bc/fsy/2019/PD60003410-2019-fsy-planning-guide-eng.pdf?lang=eng) and [2020 FSY Staff Handbook](https://www.churchofjesuschrist.org/youth/fsy/bc/fsy/2020/PD60002660-2020-fsy-staff-handbook-eng.pdf?lang=eng). A public 2026 International Staff Handbook was not located during this pass, so the product does not claim one as a source.
