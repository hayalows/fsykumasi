# Phase 5 release validation

Date: 2026-09-08
Branch: `ux-operations-overhaul`
Production target: `main`

## Release boundary

Phase 5 hardens the UI and release process. It does not change participant roster data, groups, staff assignments, FSY IDs, access grants, check-ins, housing assignments or any other live operational record. No database migration is part of Phase 5.

The five-phase branch remains separate from production until the final integrated validation is accepted. A passing build is necessary but is not by itself permission to merge.

## Write reliability contract

Important writes must follow these rules:

1. A rapid second click must not start a duplicate request before React paints the disabled state.
2. A write is never described as successful until the server confirms it.
3. While a consequential write is running, related controls stay disabled and the work surface exposes `aria-busy`.
4. Network or timeout failures are described as failures and offer a safe retry path. The UI must not guess that a write succeeded.
5. Consequential actions keep explicit confirmation. Final roster apply and FSY ID finalization remain protected.
6. Server-side validation remains authoritative. Client guards reduce accidental duplicate submissions but do not replace database/RPC checks.
7. After success, the UI refreshes the affected state or records an explicit success receipt.
8. Refresh/close protection is active while critical account, identity or final-roster writes are in flight.

Phase 5 applies a shared single-flight guard to account security, FSY identity writes, leadership exception decisions and the final-roster workflow. Existing guarded RPC and transaction behavior remains in place for day-of operational modules.

## Accessibility contract

The integrated release must retain or add:

- visible `:focus-visible` treatment for keyboard users;
- arrow-key plus Home/End support for shared segmented tabs;
- focus trapping, Escape dismissal and focus restoration for shared dialogs/sheets;
- assertive atomic announcements for mutation errors and polite atomic announcements for success;
- a route live region driven by `PageHead`, plus document-title updates;
- explicit `aria-busy` on active write surfaces;
- `aria-invalid` and described password requirements on the Account form;
- 44px minimum targets for coarse pointers;
- reduced-motion support;
- forced-colors and increased-contrast fallbacks;
- identifying names and operational values that wrap instead of being clipped.

This is a release hardening pass, not a claim of formal WCAG certification. A full assistive-technology audit remains separate work.

## Responsive validation matrix

Every primary route should remain usable at these CSS viewport widths:

| Width | Release expectation |
| --- | --- |
| 320px | No page-level horizontal clipping. One-column operational rows and reachable actions. |
| 375px | Phone layout with readable names, full labels and safe sheets. |
| 390px | Primary mobile validation target used in the earlier audit. |
| 414px | Wider phone layout without reintroducing desktop-only widths. |
| 768px | Tablet/narrow desktop reflow with bounded data regions. |
| 1024px | Compact desktop with useful table density. |
| 1440px | Full desktop planning/admin layout. |

The Phase 5 stylesheet contains explicit 320, 375, 390, 414, 768 and 1024 contracts. The base desktop layout covers 1440.

## Failure and recovery scenarios

Before production merge, the integrated branch should be checked against:

- slow request;
- double click / repeated submit;
- network interruption during a write;
- offline then reconnect;
- server rejection;
- stale or changed record after the user opened a form;
- permission change while a form is open;
- concurrent edit by another leader;
- accidental navigation while a consequential action is still running;
- long Ghanaian names and long ward/stake values;
- missing company/group/unit values;
- large datasets;
- 200% text enlargement and 400% browser zoom;
- keyboard-only navigation;
- reduced motion;
- forced-colors/high-contrast mode.

## Automated gate

The pull-request workflow must pass:

1. dependency install;
2. production Vite build;
3. full Node regression suite, including Phase 5 contracts;
4. verified frontend artifact upload;
5. Sites worker verification.

### Automated result on Phase 5 head

GitHub Actions run `34267360649` passed the complete gate on the Phase 5 integration head used by PR #91:

- production Vite build passed;
- 319 / 319 project tests passed;
- verified frontend artifact `fsy-kumasi-frontend` uploaded successfully;
- 4 / 4 Sites worker tests passed;
- no test was skipped, cancelled or marked todo.

The generated production build still reports the existing Vite advisory that one application chunk is above 500 kB after minification. It is a performance advisory rather than a build failure. The current five-phase work deliberately did not turn that advisory into a risky late-stage code-splitting rewrite.

Phase 5 tests check the source-level contracts for single-flight writes, password validation, page-exit protection, live-region feedback, responsive targets, confirmation safeguards and release-layer ordering.

## Manual/browser gate

A browser pass on the integrated build should still be completed before merging to `main`, especially for 320/375/390/414 layouts, keyboard focus order and high-risk write flows. Vercel preview generation is currently blocked by the Hobby build-rate limit. That limitation is recorded rather than bypassed by deploying the unfinished branch to production.

This means the Phase 5 engineering build and automated gate are complete, while the final visual/browser release check remains an explicit pre-merge gate.

## Production merge rule

Do not merge individual phases. Merge the single integrated pull request only after all five engineering phases are complete, automated verification is green, known deployment blockers are understood, and the final browser/release review is accepted.
