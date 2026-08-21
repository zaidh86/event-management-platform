# ADR-0013: Solarized Visual Theme

**Status:** Accepted (supersedes ADR-0006 "Emerald Command" visual identity) ·
**Scope:** frontend tokens only — no layout, UX, routing, database, or behavior
change.

## Decision

EMP's visual language is now **Solarized**: Solarized Dark is the default
(`:root`), Solarized Light is the `[data-theme="light"]` override. The theme
machinery is untouched — ThemeContext (Dark / Light / System, chosen in
Settings → Appearance), the pre-paint stamp in `index.html`, and the rule that
components reference `var(--…)` tokens only. Because the entire application
already flowed through the central token blocks (zero hardcoded component
colors), the migration is those two blocks plus the browser `theme-color`
metas.

## Semantic mapping

| Role | Dark (default) | Light |
|---|---|---|
| Page / cards / inputs | base03 / base02 / lightened base02 | base2 / base3 / base2 (elevation is *lighter*) |
| Text / muted | base1 / base00 | base01 / base00 |
| Primary interactive | blue `#268bd2` (text on blue fills = base03, 4.7:1) | same |
| Success / positive | green | green shade `#677c00`¹ |
| Warning | yellow | orange (yellow fails on base3¹) |
| Danger / error | red tint `#e35f5c`¹ | red |
| Ranks 1/2/3 | yellow / base1 / orange | yellow shade¹ / base00 / orange shade¹ |
| Per-event default tint | blue | blue |

¹ Derived tint/shade of the Solarized hue where the pure value fails WCAG
contrast on our surfaces (each is commented at its definition). Everything
else is palette-pure. Status meaning is never carried by color alone (badges,
icons and text labels persist).

Gold-for-achievement (ranks, certificates, featured stars) maps to Solarized
yellow. Organizer-chosen `events.theme_color` values are unchanged — they
remain decorative-only tints that cannot carry text.

## Deliberate literals

The QR quiet zone stays `#ffffff` (scannability), and the print stylesheet
stays white/near-black (paper). Both are commented in `index.css`.
