# Progressive mobile operations decision

Date: 2026-09-02
Status: In development, not deployed to production

## Why this pass exists

FSY Kumasi has dense operational data: roughly 1,600+ youth, many counselor groups, many companies, staff assignments, check-in, and recurring head counts. The data needs to stay available without forcing a leader to scroll through everything at once.

The design goal is: **show the decision or action first, then disclose the supporting detail only when the leader asks for it.**

## UX principles being applied

1. **Progressive disclosure.** Core actions and status appear first. Advanced settings, company contents, group rosters, and head-count editing are disclosed on demand.
2. **Preserve context.** Opening a company, group, participant, or head-count item should feel like drilling into the current task rather than jumping to an unrelated screen.
3. **One clear primary action.** Each workflow should make the next useful action visually obvious while keeping secondary controls quieter.
4. **Search near long data.** Search and filters belong directly above the list they affect.
5. **Familiar hierarchy.** Rows use disclosure indicators and predictable open/close behavior rather than custom gestures.
6. **Touch-first controls.** Mobile controls target at least the familiar ~44px touch size and leave enough spacing to avoid accidental taps.
7. **Reversible, reviewable actions.** Destructive or large changes should be previewed. Existing assignments are not silently overwritten. Check-in already supports undo; the same mindset applies elsewhere.
8. **Responsive, not merely smaller.** Mobile shows less at once and uses bottom-sheet style details where appropriate; desktop can keep split views and wider summaries.

Reference guidance used during this pass:
- Apple Human Interface Guidelines: Design principles, Accessibility, Lists and tables.
- Nielsen Norman Group: Progressive Disclosure and cognitive-load guidance.

## Grouping decision: ages are mixed by default

The age-band split is no longer the normal model.

- Counselor groups remain same sex.
- Ages are deliberately distributed across each same-sex counselor pool where the source data allows it.
- The algorithm alternates age extremes and scores candidate groups to reduce repeated ages, keep group averages close to the pool average, and increase age range.
- Ward/branch mixing remains a separate preference.
- Explicit age-band separation remains available as an exception, not the default.

This matches the operational intent for Kumasi: a 14-year-old can be grouped with 17-year-olds rather than automatically being isolated into a 14–15 band.

## Groups & companies interaction model

The published structure becomes a directory rather than a wall of cards:

**Companies → counselor groups → youth.**

A company is collapsed by default and shows only its name, youth count, group count, counselor coverage, and staffing state. Opening it reveals counselor groups. Opening a group reveals the actual youth in that group, including age and ward/branch. Search can locate a company by company/group metadata or by a participant name/ward. Only the first 20 matching companies render initially; more are disclosed on request.

## Staffing model

Staffing gets a review-first assistant:

- Suggest only currently empty counselor-group and company-AC assignments.
- Respect counselor/group sex matching.
- Do not replace assignments that already exist.
- Spread unassigned companies across available Assistant Coordinators rather than requiring manual one-by-one selection.
- Allow reshuffling before applying.
- A new backend RPC is being introduced so a reviewed bulk plan can be validated and applied transactionally instead of relying on many unrelated writes.

## Head-count interaction model

A head-count round is a summary first. The leader opens the round detail only when needed.

Inside the round, the default view is **Awaiting**, not all companies. Filters expose Awaiting, Exceptions, Reported, and All. Search sits beside those filters. Pending companies get a one-tap **All here** action; manual count editing is disclosed only when the company row is opened.

This keeps an 80+ company round usable on a phone without hiding any data.

## Mobile-specific direction

- Five primary mobile destinations remain in the bottom navigation.
- Dense configuration stays behind disclosure sections.
- Search/filter toolbars can remain visible while scrolling long operational directories.
- Participant details can behave like a bottom sheet on supported mobile browsers, preserving the directory behind them.
- Modal dialogs become bottom sheets on smaller screens.
- Reduced-motion preferences are respected.

## Theme treatment

The overview keeps the 2026 theme visible without becoming a decorative detour. A short Moses 6:34 excerpt is shown beneath the theme, with the phrases around abiding and walking together visually emphasized.

## Reuse beyond Kumasi

The long-term architecture should treat **FSY Operations** as the reusable product and a specific event/session as configuration.

The existing `session_id` model already helps. The next reuse pass should move remaining hard-coded event presentation into a session configuration layer, including:

- display name and location
- year and dates
- theme label/reference/artwork
- terminology overrides only where truly required
- structure defaults
- venue-specific operational notes

Operational components should continue to work against session-scoped data rather than Kumasi-specific IDs or names. This makes the same web app reusable by another FSY session without forking the codebase.

## Release discipline

This work is isolated on `ux/mobile-progressive-operations`. It must pass tests and build checks and be reviewed in a pull request before any production database migration or Vercel deployment. Production remains unchanged until an explicit release decision.
