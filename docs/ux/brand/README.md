# OpenGlass brand assets

Official, locked brand marks. Baked vector outlines — no font dependency,
no text nodes. Do not redraw; reuse these files.

## logo-tile.svg — app icon / logo tile

```
tile:      64 × 64 · radius 6 · fill #181818 (ink)
letters:   "og" · Source Code Pro Bold (700) · fill #ffffff
           em scale 0.024 (1000upm → 24px)

glyph bbox (rendered, tile coords):
  o:  x[25.70 .. 37.84]  y[23.37 .. 35.85]   w 12.14 × h 12.48
  g:  x[40.22 .. 52.70]  y[23.37 .. 40.63]   w 12.48 × h 17.26 (descender)
  union: x[25.70 .. 52.70] y[23.37 .. 40.63] → w 27.00 × h 17.26

centerline: vertical center = 32.0 (optically centered incl. descender)
            horizontal center = 39.2 → letters sit +7.2px RIGHT of
            geometric center — LOCKED optical offset, intentional
            (compensates the left-heavy "g" descender)

stroke thickness (bold, font units / px@24em):
  'o' horizontal stem: 151u ≈ 3.62px
  'o' vertical stem:   119u ≈ 2.86px
  advance: 600u = 14.40px per glyph
```

## wordmark.svg — "openglass" lockup

```
viewBox 0 0 129.60 × 30.20 · fill="currentColor" (tints via CSS color)
text: o p e n g l a s s — lowercase only
weights: o(700) p e n (400) g(700) l a s s (400)
em scale 0.024 → cap height 15.84 · x-height 11.90 · advance 14.40
```

Usage: `<img src="brand/wordmark.svg">`, recolor with `color:` on parent.

## Rules

1. `og` always lowercase, always Bold 700 — never regular.
2. Wordmark always lowercase; bold only on `o` + `g`.
3. Minimum tile size 24px; minimum wordmark width 64px.
4. Clearspace = ¼ tile edge around both marks.
5. Regenerate only via fontTools from `docs/ux/fonts/` woff2 —
   never hand-edit the paths.
