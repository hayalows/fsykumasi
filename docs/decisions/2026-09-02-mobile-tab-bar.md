# Mobile tab bar direction

The FSY Operations mobile navigation follows the common ground between Apple's iOS tab-bar guidance and Material 3 navigation bars:

- Reserve the bottom bar for top-level navigation, not page actions.
- Keep the visible set small and stable for a given role/session; FSY uses 4–5 destinations including More.
- Give every destination a short text label and a familiar icon.
- Distribute destinations evenly across compact-width screens.
- Keep the selected state clear without turning the whole tab into a large card.
- Treat additional tools as secondary navigation behind More instead of overcrowding the bar.
- Respect system safe areas and keep the navigation surface visually separate from content.

For FSY, the visual treatment is a full-width translucent system surface rather than a detached floating capsule. The selected destination gets the brand tint plus a restrained icon-level pill. Inactive destinations remain monochrome. This keeps the control predictable in Safari and in standalone PWA mode while retaining a modern iOS/Material feel.
