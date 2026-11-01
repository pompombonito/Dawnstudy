# Chibi proportions audit

Verified 2026-11-02 against all 80 anime companions, including the five Kaoru Hana characters.

## Verification

- Visually inspected the complete roster and twelve enlarged portraits for head, eye, ear, hair, clothing, and accessory alignment.
- Rendered the current React SVG components with unique SVG identifiers and the production motion stylesheet in headless Edge.
- Sampled all 80 SVG geometry bounds at 0, 2, 4, 6, 8, 10, and 12 seconds. No geometry exceeded the 100 × 100 viewBox in any final sample.
- Checked the tightest margins against the current outline widths. Geometry measurements use SVG `getBBox()`, which excludes stroke; sampling supplements visual inspection rather than proving every intermediate frame.

## Verified corrections

| Character | Correction | Final sampled bounds |
| --- | --- | --- |
| Luffy | Dedicated low fringe keeps black hair underneath the straw-hat crown. | Horizontal extent approximately 2.88–97.12. |
| Gon | Raised the highest hair spike's coordinate from y=1 to y=2 to leave room for the outline and sway. | Minimum y approximately 1.87–1.97. |
| Shin-Ah | Lowered the forehead mask ornament by two units so its tip remains inside the frame. | Minimum y approximately 1.76–1.86. |
| Rimuru | Shortened the scarf tail that previously ended at y=102. | Maximum y=98. |
| Chopper | Shortened the torso, suspenders, and paws that previously extended beyond the bottom. | Maximum y=98.5. |

Broad heads and small bodies are retained as the requested chibi style. Eyes, ears, glasses, and intended hidden-eye/mask coverage align consistently; no roster-wide repositioning was necessary. The five new Kaoru Hana portraits follow the same proportions.

Local QA images are temporary and intentionally not committed: `dawnstudy-proportion-audit.png` contains twelve enlarged examples, and `dawnstudy-all80-proportions-final.png` contains the final roster.
