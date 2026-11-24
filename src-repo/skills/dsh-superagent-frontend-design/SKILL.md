---
name: dsh-superagent-frontend-design
description: Build and refine high-craft web interfaces and interactive components — design-system grounding, responsive layouts, modular JSX/CSS architecture, and accessible UI states.
---

Root every frontend change in the project's existing design language rather than inventing disconnected styles.

## Grounding in Existing Design Context

1. **Read existing components, CSS tokens, and layout primitives first.** Match the repository's color variables, spacing scale, typography, border radii, icon system, and bilingual locale dictionaries.
2. **Use harmonious palettes (`oklch` or theme tokens)** when extending styles; avoid jarring unstyled defaults or clashing ad-hoc hex colors.
3. **Keep components modular and maintainable.** Split files before they exceed ~800–1000 lines, and namespace style objects or CSS classes clearly to prevent collisions.

## Interaction, Accessibility, and Responsiveness

- Ensure layouts adapt cleanly across desktop and mobile viewports without horizontal overflow or clipped controls.
- Provide clear visual states for loading, empty, hover, focus, disabled, and error conditions, using accessible semantic elements (`button`, `label`, `input` with `min`/`required`, ARIA attributes where needed).
- For large dynamic lists or operator-configurable slot tables, paginate or window visible rows while keeping active overrides and boundary items directly accessible so large counts never freeze the DOM.
