# FSY Operations project log

This file records product and engineering decisions that materially change how the operations system behaves. Pull requests and migration files remain the source of truth for implementation details.

## 2026-09-02 · Mobile progressive operations pass

Branch: `ux/mobile-progressive-operations`
Production status: **not released**

### Decisions

- Mixed ages become the normal grouping default. Same-sex counselor groups remain; automatic age-band separation becomes an exception.
- Grouping algorithm now tries to distribute the available ages across each counselor pool while continuing to avoid same-unit repetition where possible.
- Groups & Companies moves to a Company → Group → Youth disclosure hierarchy.
- Company search can resolve participant names and wards as well as company/group metadata.
- Long company directories render progressively rather than all at once.
- Head count becomes Round summary → filtered company list → company detail, defaulting to companies still awaiting a report.
- Pending head counts retain a one-tap `All here` action; manual exception entry is secondary.
- Staff assignment gets a review-first suggestion workflow for empty counselor and Assistant Coordinator positions.
- A transactional backend RPC is added for applying reviewed bulk staff plans safely.
- Mobile controls and sheets receive a responsive interaction layer with larger tap targets and reduced information density.
- The 2026 theme area adds a short Moses 6:34 excerpt.
- Reusability direction: treat the operations app as generic and move event-specific presentation into session configuration over time.

### Files introduced or substantially changed

- `src/lib/grouping.js`
- `src/lib/operations.js`
- `src/pages/Groups.jsx`
- `src/pages/Headcount.jsx`
- `src/pages/Overview.jsx`
- `src/progressive.css`
- `tests/grouping.test.mjs`
- `supabase/migrations/20260902080000_mixed_age_structure_default.sql`
- `supabase/migrations/20260902080500_atomic_staff_assignment_plan.sql`
- `docs/decisions/2026-09-02-progressive-mobile-operations.md`

### Release rule

Do not apply the two new database migrations or deploy the branch to production until the branch CI is green and the UX is reviewed.
