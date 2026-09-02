# @palscans/ui

Shared React 19 components for PALScans. Server-safe unless the file starts with
`'use client'` (`Sheet`, `Toast`, `RelativeTime`). Styled with Tailwind v4 utilities that
reference the `--color-*` tokens from `docs/16-build-plan.md` — never literal colours.

The package exports TypeScript source (`src/index.ts`); `apps/web` transpiles it through
`transpilePackages` and scans it for Tailwind classes via `@source` in `globals.css`.
