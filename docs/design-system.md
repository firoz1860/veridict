# Veridict design system

An editorial trust-and-safety identity: warm off-white surfaces, charcoal ink, restrained teal (light) / cyan (dark) accents, hairline dividers, and a disciplined type scale. The public introduction is expressive; the authenticated workspace stays efficient and readable. Tokens are defined once in `web/styles.css` on `:root`; every screen uses them.

## Typography

- **Display:** Raleway (700/800), used for hero, section headings, page titles, stat numbers, and brand.
- **UI / body:** Inter (400–700), used for all dense application text, tables, forms, and metadata — chosen for legibility at 12–15px.
- **Clamp scale:** hero `clamp(38px, 7.2vw, 92px)`; public section `clamp(32px, 4.6vw, 54px)`; app page heading `clamp(26px, 3.1vw, 34px)`; body 15px; labels/metadata 11–12px.

## Color tokens

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#FBFAF8` | Warm page background |
| `--surface` / `--surface-sunken` | `#FFFFFF` / `#F7F5F0` | Cards / insets |
| `--ink` / `--ink-2` / `--ink-3` | `#16181B` / `#565A60` / `#696D73` | Primary / secondary / metadata text |
| `--border` / `--border-strong` | `#E8E3D9` / `#CFC8B8` | Hairlines |
| `--accent` / `--accent-ink` | `#0F7481` / `#0C5A64` | Teal fills / teal text |
| `--dark` / `--on-dark` | `#15191C` / `#F2EFE9` | Dark surfaces / text on dark |
| `--cyan` | `#45C0D2` | Accent on dark surfaces |
| `--ok` / `--warn` / `--danger` / `--info` | `#1F7A52` / `#8A5A14` / `#B23A3A` / `#35656D` | Semantic (each paired with a soft bg + border) |

**Status semantics (never colour-only):** green = allowed/resolved/low; amber = pending/uncertain/warn/awaiting re-evaluation; red = remove/failed/critical/high; slate = analyzing/under-review. Every badge also carries a text label; findings add an icon + a text source tag (deterministic vs AI).

### Contrast (WCAG, verified)

All text pairs meet AA. Measured ratios: ink on bg 17.1; secondary 6.7; metadata 4.8; teal on white 5.5; white on teal 5.5; on-dark on dark 15.4; cyan on dark 8.2; semantic text on its soft bg 4.6–5.5.

## Spacing, radii, elevation, motion

- **Radii:** `--r-sm 6` / `--r 10` / `--r-lg 14` / `--r-xl 20`. Restrained — no pill-everything, no glass.
- **Shadows:** `--shadow-sm` for cards, `--shadow` on hover, `--shadow-lg` for dialogs. Subtle, warm-tinted.
- **Motion:** `--t-fast 120ms`, `--t 200ms`. CSS transitions for controls; SVG/CSS for public diagrams. All continuous/scrubbed motion is disabled under `prefers-reduced-motion`.
- **Containers:** app `1680px`, public `1180px`, sidebar `248px`.

## Components (shared, class-based)

Buttons (primary/secondary/text/danger/ghost-dark), badges (semantic), panels + panel-heading, tables, filters/search, pagination, stat cards, findings (source-tagged), evidence citation button, notices/errors/empty/loading, accessible confirm dialog, forms + password reveal, skip link, app sidebar + topbar, public header/hero/sections/footer.

## Accessibility

- Skip-to-content link on every shell; semantic headings; focus-visible rings (teal on light, cyan on dark).
- Accessible confirmation `dialog` (role=dialog, aria-modal, focus trap, Escape, focus restore) replaces all native `window.confirm`; destructive action is never the default focus.
- Mobile navigation: `aria-expanded`/`aria-controls` toggles, modal drawer with scrim, Escape to close, focus restored to the toggle, hidden links are unfocusable.
- Role selector on `/about` is a proper `tablist` with arrow-key navigation.
- No color-only meaning; touch targets ≥ ~42px; layouts verified with no horizontal overflow at 390/768/1024/1440.

## Files

- `web/styles.css` — tokens + all component and layout styles (single stylesheet, sectioned).
- `web/pages/public/About.tsx` — the expressive public introduction (lazy-loaded as a separate chunk).
- `web/main.tsx` — app shell, routing, screens, shared components (`Button`, `Badge`, `ConfirmDialog`, `Findings`, …).
