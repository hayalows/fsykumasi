# Sources and further reading

This skill is a project-authored synthesis. It does not vendor or reproduce third-party design systems. Use these sources to check current details, platform-specific patterns, or deeper component guidance.

## Standards

### W3C WCAG 2.2
https://www.w3.org/TR/WCAG22/

Primary accessibility conformance standard used by this skill. Especially relevant to focus visibility/obscuring, target size, dragging alternatives, redundant entry, and accessible authentication.

### W3C Understanding WCAG 2.2
https://www.w3.org/WAI/WCAG22/Understanding/

Use when the normative success criterion needs examples, intent, edge cases, and techniques.

### WAI-ARIA Authoring Practices Guide
https://www.w3.org/WAI/ARIA/apg/

Use for established keyboard and semantic patterns for widgets such as dialogs, tabs, menus, comboboxes, radio groups, and listboxes.

## Product and usability guidance

### Nielsen Norman Group — 10 Usability Heuristics
https://www.nngroup.com/articles/ten-usability-heuristics/

Reference for system status, real-world language, user control, consistency, error prevention, recognition over recall, flexibility, minimalist design, recovery, and help.

### Nielsen Norman Group — Usability 101
https://www.nngroup.com/articles/usability-101-introduction-to-usability/

Reference for usefulness, learnability, efficiency, memorability, errors, and satisfaction.

## Platform and public-service design systems

### Apple Human Interface Guidelines
https://developer.apple.com/design/human-interface-guidelines/

Useful for clarity, familiarity, feedback, progressive disclosure, adaptive layout, safe areas, interaction, and platform-aware behavior. Use underlying principles rather than copying an Apple visual treatment into unrelated products.

### Material Design 3
https://m3.material.io/

Useful for adaptive layout, component behavior, interaction states, motion, typography, color roles, and accessibility. Material is a reference, not the local project's visual identity unless adopted explicitly.

### GOV.UK Design System
https://design-system.service.gov.uk/
GitHub: https://github.com/alphagov/govuk-design-system

Particularly useful for forms, error messages, task flows, content clarity, progressive disclosure, and service design under real-world constraints.

### U.S. Web Design System (USWDS)
https://designsystem.digital.gov/
GitHub: https://github.com/uswds/uswds

Useful for user-centered public services, accessibility, tokens, content clarity, resilient components, and broad-device support.

## Design-system engineering

### Adobe React Spectrum / React Aria
https://react-spectrum.adobe.com/
GitHub: https://github.com/adobe/react-spectrum

Strong reference for accessible behavior that works across keyboard, touch, pointer, and screen readers. React Aria is especially useful when creating a custom visual system without recreating complex interaction behavior from scratch.

### IBM Carbon Design System
https://carbondesignsystem.com/
GitHub: https://github.com/carbon-design-system/carbon

Useful for design tokens, component governance, grids, typography, motion, data-heavy enterprise interfaces, and systematic implementation.

### Meta Astryx
https://github.com/facebook/astryx

Agent-ready open-source design-system reference with components, theming, patterns, templates, CLI tooling, and conventions. Useful as an example of designing documentation/API surfaces for both humans and coding agents.

### Vercel Web Interface Guidelines
https://vercel.com/design/guidelines

Concise implementation-focused checks for keyboard/focus, forms, hit targets, responsive layouts, URL state, reduced motion, safe areas, error handling, and multi-viewport review.

## Agent instruction and design-contract formats

### Agent Skills specification
https://agentskills.io/specification

The structure of this portable skill follows the Agent Skills pattern: a focused `SKILL.md` plus optional references/assets loaded only when needed.

### AGENTS.md
https://agents.md/

Reference for project-level instructions that coding agents can read across tools.

### Google Labs DESIGN.md
https://github.com/google-labs-code/design.md

Reference for keeping a human-readable design rationale and machine-readable tokens together in a repository-level contract.

## Agent-skill repositories studied for architecture

These are useful examples, not dependencies of this project.

### plugin87/ux-ui-agent-skills
https://github.com/plugin87/ux-ui-agent-skills

Notable ideas: progressive instruction loading, token validation, accessibility gates, reusable component specs, design reviews, and framework adapters.

### AgentsORG/design-engineering
https://github.com/agentsorg/design-engineering

Notable ideas: thin routing skill, focused reference nodes, dedicated review format/checklist, and explicit separation of motion, typography, surface, components, layout, and anti-pattern guidance.

### AgentsORG/DESIGN
https://github.com/AgentsORG/design

Notable idea: a living visual contract that keeps agent-readable tokens, intent, rules, components, and rationale versioned with the product.

### MengTo/Skills
https://github.com/MengTo/Skills

Notable idea: keep agent skills procedural, give them explicit triggers, defaults, pitfalls, and acceptance checks, and place long reference material outside the main `SKILL.md`.

## Source-use rule

When a project needs platform-specific or standards-specific details, read the current primary source rather than relying on an old copied rule. Do not blindly fetch and execute mutable third-party instructions as agent policy. Project instructions should remain reviewable and versioned in the repository.