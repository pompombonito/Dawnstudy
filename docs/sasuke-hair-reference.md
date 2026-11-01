# Sasuke hair correction

Verified 2026-11-02 against the actual enlarged SVG before and after editing.

The old silhouette was a star-shaped crown with three thick central fringe triangles crossing the eyes. The forehead protector was drawn over those triangles. Sasuke now has a rounded crown with a few rear-directed points, a separate layer of ducktail spikes behind his head, and two temple locks. The central fringe no longer covers the eyes. His protector is layered behind the temple locks, with the engraved plate fully visible.

## References inspected

- [Bandai's licensed capsule rubber mascots](https://gashapon.jp/products/detail.php?jan_code=4543112969507000), including its [Sasuke miniature illustration](https://bandai-a.akamaihd.net/bc/img/model/xl/1000098547_3.jpg): inspected the swept outer silhouette, piece-like fringe and stern expression.
- [Good Smile's official Naruto Nendoroid feature](https://special.goodsmile.info/naruto/): inspected the Sasuke face and hairstyle references, including the long temple locks and distinctive rear hair spikes. This Shippuden reference informed the silhouette; Dawnstudy retains its existing early-series forehead protector and blue outfit.
- [MegaHouse's Sasuke GO! figure](https://en.megahobby.jp/products/g-e-m-series-naruto-sasuke-uchiha-go): inspected the smooth crown, framing locks and rear-directed points in profile.

These references guide an original flat SVG interpretation. No reference image is bundled into the website. Existing dark blue-black hair, individual facial expression, transparent surroundings and CSS motion are retained.

## Verification

- Visually compared enlarged 400-pixel before/after portraits.
- Sampled the corrected SVG with production motion CSS at 0, 2, 4, 6, 8, 10 and 12 seconds. Geometry remained inside the viewBox: x approximately 7.94–92.06, minimum y approximately 8.89 and maximum y 97.94. `getBBox()` measurements exclude stroke; the remaining margins also accommodate the current outlines.
- Verified all 80 anime portraits expose a native `<title>` by default using the actual attributed dialogue returned by the shared companion helper. Accessible identity labels remain intact.

The floating companion disables the native tooltip in favor of its hover/focus bubble, and occasional dialogue is handled separately in `CompanionDock.tsx`.
