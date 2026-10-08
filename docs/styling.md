# Styling

Semantic colors and Tailwind mappings share `src/styles/globals.scss`. The app is intentionally dark-only. Keep new colors token-driven and use `font-content` for manuscript text; display typography has a different role.

## Integration Traps

Keep raw CSS variables distinct from the Tailwind variables that map to them through `@theme inline`. A mapping such as `--spacing-page: var(--spacing-page)` references itself rather than a usable underlying value.

Because the hub is SCSS, package CSS containing Tailwind directives must remain a CSS import for PostCSS/Tailwind. The relative built-CSS import for `tw-animate-css` prevents Sass from inlining and parsing Tailwind-specific `@utility` rules. Replacing it with a conventional Sass package import can break compilation.

Configuration, font mappings, and component conventions are visible in their source files; they are not duplicated here.
