# FSY Kumasi agent instructions

## UI and UX work

For any task that changes a user-facing interface, interaction, responsive layout, navigation, form, table, modal, sheet, loading state, error state, empty state, or visual system:

1. Read `DESIGN.md`.
2. Read `.agents/skills/product-ui-ux/SKILL.md` and only the reference files it routes you to.
3. Inspect the existing implementation before proposing or editing. Reuse the current design system in `src/design-system/` and the shared UI components before adding one-off styles or new dependencies.
4. Understand the user's actual task, role, pressure level, device, permissions, and failure cases. Do not redesign from a screenshot alone when the surrounding flow or code changes the answer.

The project design contract and existing product behavior outrank generic design advice. If a generic rule conflicts with an intentional project rule, preserve the project rule and explain the tradeoff.

## Product posture

FSY Operations is an operational tool, not a marketing site. It should feel calm, direct, fast, and predictable under pressure.

- Optimize for task completion, not decoration.
- Prefer one obvious primary action per decision point.
- Use progressive disclosure for uncommon or risky actions.
- Keep important status and the next useful action close together.
- Prefer recognition over recall. Keep labels explicit and use familiar language.
- Preserve context after actions. Avoid unnecessary full-page resets or navigation.
- Make recovery easy. Prefer Undo or reversible actions when the domain allows it.
- Show useful loading, empty, error, partial, busy, success, disabled, and permission states.
- Do not rely on color alone for status.
- Avoid card-on-card layouts, excessive shadows, excessive rounding, decorative gradients, duplicate summaries, and animation that does not help orientation or feedback.
- Keep dense operational information scannable. Density is acceptable when hierarchy remains clear.

## Responsive posture

Responsive quality includes viewport height, not only width.

- Test phone, tablet, short laptop, normal laptop, and large desktop compositions.
- Treat `1366x768` and `1440x900` as first-class desktop checks, not edge cases.
- Keep critical actions reachable without requiring needless scrolling when the viewport has enough room.
- Prefer one scroll owner in a modal or sheet. Avoid nested scroll regions unless the content genuinely requires an independently scrollable area.
- Do not let sticky headers, footers, bottom navigation, or action bars cover focused controls or content.
- Respect safe areas and use `dvh`/intrinsic CSS layout where appropriate.
- Mobile text inputs should render at 16px or larger to avoid iOS focus zoom.
- Do not disable browser zoom.

## Accessibility baseline

Target WCAG 2.2 AA as the minimum product baseline.

- Use semantic HTML before ARIA.
- All interactive flows must work with keyboard alone.
- Focus must be visible and not obscured by sticky UI or overlays.
- Dialogs and sheets need correct focus entry, containment where appropriate, Escape/Cancel behavior, and focus return.
- Controls need accessible names; icon-only actions require explicit labels.
- Prefer a 44px interactive target for primary mobile controls. Never go below the applicable WCAG target-size rules without a valid exception.
- Errors should identify the problem and the next useful action, and should be associated with the relevant field.
- Respect `prefers-reduced-motion`.

## Existing FSY design system

Use the semantic system already in the repo:

- `src/design-system/tokens.css`
- `src/design-system/foundation.css`
- `src/design-system/components.css`
- `src/design-system/compositions.css`
- `src/design-system/patterns.css`
- `src/design-system/operations.css`
- `src/design-system/overlays.css`
- `src/design-system/responsive.css`
- `src/design-system/refinements.css`

Prefer semantic tokens such as `--ds-brand`, `--ds-text`, `--ds-line`, `--ds-space-*`, `--ds-radius-*`, `--ds-control`, and the motion tokens instead of introducing arbitrary values. When an exception is truly needed, keep it local and explain why the system cannot express the requirement.

Do not widen permissions, change operational rules, or alter database/RLS behavior as part of a visual cleanup unless the task explicitly requires it.

## Verification before calling UI work complete

For meaningful UI changes:

1. Run the existing build and test commands used by the repository.
2. Check the changed flow, not just the changed component.
3. Verify at relevant phone and desktop sizes, including a short laptop viewport.
4. Check hover, focus-visible, active, disabled, busy/loading, error, empty, success, and long-content behavior where applicable.
5. Confirm no unexpected horizontal scrolling, hidden primary action, clipped text, focus trap, covered focus, or mobile input zoom.
6. Confirm the result still matches `DESIGN.md` and the existing product language.

If the task is audit-only, report findings and do not edit unless the user asked for changes.