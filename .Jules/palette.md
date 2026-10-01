## 2025-05-20 - HTML5 Drag-and-Drop Keyboard Accessibility
**Learning:** HTML5 native drag-and-drop (`draggable="true"`) is completely inaccessible to keyboard-only and screen reader users unless alternative keyboard controls (e.g. `Alt + Up/Down` arrow shortcuts) and ARIA attributes (`aria-roledescription`, `aria-keyshortcuts`) are explicitly provided.
**Action:** When making list items draggable, always attach an `onKeyDown` handler for keyboard movement and add informative ARIA attributes so screen readers announce reorderability.
