# Styling

LocalInk uses Tailwind v4 with a single SCSS configuration hub at `src/styles/globals.scss`.

## Global Styling Hub

`src/styles/globals.scss` owns:

- Tailwind and animation imports: Tailwind core plus the built CSS from `tw-animate-css`.
- Dark-only app tokens: `:root` sets `color-scheme: dark` and all semantic colors use OKLCH values for the dark UI.
- Class-driven dark selectors remain available through `@custom-variant dark (&:is(.dark *));`, and `src/app/layout.tsx` applies `className="dark h-full"` to `<html>`.
- `@theme inline` mappings that expose tokens to Tailwind utilities.
- Base shadcn-style element rules.

LocalInk does not currently support a light theme. Keep new colors mapped through semantic tokens instead of adding one-off palette values to components.

There is no `tailwind.config.ts`. Tailwind utilities come from the CSS `@theme inline` block.

## Token Layers

- Raw variables: `--primary`, `--background`, `--page-spacing`, `--radius`.
- Tailwind mappings: `--color-primary`, `--spacing-page`, `--radius-lg`.
- Semantic utilities: `bg-primary`, `text-body`, `px-page`, `rounded-lg`, `max-w-workspace`.

Keep raw variables and Tailwind theme variables distinct when a token is mapped through `@theme inline`; avoid self-references like `--spacing-page: var(--spacing-page)`.

Because the hub is SCSS, package CSS that contains Tailwind v4 directives must stay as a CSS import for PostCSS/Tailwind to process. `tw-animate-css` is imported through its built CSS file with a relative `node_modules` path so Sass does not inline and parse Tailwind-specific `@utility` rules.

## Fonts

`src/app/layout.tsx` loads DM Sans, DM Serif Display, DM Mono, and Literata with `next/font/google`. The font variables are attached to `<body>` and mapped in `@theme inline`:

- `--font-dm-sans` -> `--font-sans`
- `--font-dm-serif` -> `--font-serif`
- `--font-literata` -> `--font-content`
- `--font-dm-mono` -> `--font-mono`

Use `font-content` for long-form manuscript text. Reserve `font-serif` for display headings and titles.

## shadcn/ui

`components.json` is configured for:

- Style: New York
- Tailwind v4: no config path
- CSS variables: enabled
- CSS path: `src/styles/globals.scss`
- Component target: `@/components/common`
- Utility helper: `@/lib/util`

Common components live in `src/components/common/` and follow the shadcn v4 pattern: `data-slot` attributes, CVA for variants where useful, `cn()` for class merging, and app-specific props only where they improve repeated use.

Toast messages use the shadcn Sonner component. `src/app/layout.tsx` mounts `Toaster` globally from `src/components/common/sonner.tsx`, so client components can call Sonner's `toast` API directly.

Show an error toast whenever a user-visible operation encounters an error, including failed saves, deletes, loads, and unexpected action failures. Keep field validation and actionable form errors inline as well, but do not rely on inline-only messaging for operation-level failures. Toast messages must be sanitized and user-facing; do not include stack traces, raw prompts, manuscript text, or local filesystem paths.
