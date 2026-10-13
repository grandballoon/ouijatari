# ouijatari

The Ouijatari interface bench, published to GitHub Pages behind a passphrase.

## How the protection works

GitHub Pages serves static files with no server-side authentication, so the
protection is cryptographic rather than access-controlled.
The published `index.html` contains the real page encrypted with AES-256-GCM,
under a key derived from a shared passphrase by PBKDF2-SHA256 (600,000
iterations), plus a small gate that decrypts it in the browser via WebCrypto.

Without the passphrase there is nothing to bypass — the ciphertext is all that
is on the wire and all that is in the repository.
An incorrect passphrase fails GCM authentication and is rejected.

Note what this does and does not give you.
It is a single shared passphrase, so it cannot be revoked for one person
without re-encrypting and redistributing it to everyone else, and it leaves no
record of who opened the page.
If you need per-person access, revocation, or an audit trail, the page belongs
behind Cloudflare Access or an equivalent proxy instead.

## Layout

| Path | |
|---|---|
| `src/` | The real page. **Gitignored** — never commit it. |
| `src/index.html` | Markup, styles, rendering and interaction. Holds no rules. |
| `src/engine.js` | The pipeline: reading → plate → nail → Growth Field. Pure, no DOM. |
| `src/data.js` | Generated. The plate catalog and the wall model. |
| `space_and_plates/` | Source artwork and gallery model. **Gitignored.** |
| `index.html` | Generated. Encrypted payload + gate. This is what ships. |
| `tools/gate.html` | Gate template; holds the browser-side decryptor. |
| `tools/encrypt.mjs` | `src/` → `index.html`. |
| `tools/decrypt.mjs` | `index.html` → `src/`. |
| `tools/bundle.mjs` | Folds the scripts in `src/` into one page, and back. |
| `tools/lib.mjs` | Shared crypto, used by both scripts. |
| `tools/build-data.mjs` | `space_and_plates/` → `src/data.js`. |
| `tools/plates.mjs` | Plate vector → outline and silhouette metrics. |
| `tools/wall.mjs` | Gallery model → unfolded walls and nail lattice. |
| `tools/test.mjs` | Tests for all of the above. |

Requires Node 18+. There are no dependencies.
Rebuilding `src/data.js` additionally needs `mutool` (`brew install mupdf`).

## Editing the page

```sh
node tools/decrypt.mjs      # if you have no src/ yet
$EDITOR src/index.html      # or src/engine.js
open src/index.html         # the plaintext page runs straight from disk
node tools/encrypt.mjs      # regenerate index.html
node tools/test.mjs
git commit -am "Update page" && git push
```

Both scripts prompt for the passphrase without echoing it.
For non-interactive use, set `OUIJATARI_PASSWORD` — prefer a leading space or
your shell's history-off setting so it does not land in shell history.

Because `src/` is gitignored, the encrypted `index.html` is the versioned copy
of record; `tools/decrypt.mjs` is how you get an editable source back on a new
machine.
That includes `src/engine.js` and `src/data.js`: encryption bundles them into
the page and decryption splits them back out, so the plate catalog survives
without `space_and_plates/`. Keep the passphrase in a password manager — if it is lost, the page
is unrecoverable.

## Changing the passphrase

Re-run `node tools/encrypt.mjs` with the new one and push. Anyone with the old
passphrase can still decrypt any copy of the old `index.html` they kept, so
rotation limits future access, not past access.

## Plate and wall data

`node tools/build-data.mjs` regenerates `src/data.js` from `space_and_plates/`.
It reads the four `*_vectors/` folders of Illustrator files (75 plates each) and the SketchUp `.obj` export of the gallery.
The output is deterministic: the same sources give a byte-identical file.
Run it only when the artwork or the model changes, then re-encrypt.

Plates.
Each plate's ID is its file name without the extension (`A_8_12`).
Its outline is simplified to 0.02 in and stored in inches about the centre of its artboard.
The catalog records what a silhouette can supply: width, height, area, perimeter, compactness, elongation, silhouette density (area over convex-hull area) and a branch count.
Oxidation coverage, colour and brightness need photographs of the finished plates and are not in the catalog yet.

Wall.
The model's three nailed walls are unfolded into one elevation strip, left to right as seen from inside the room.
Nails are named row-column: `E-34` is the fifth row down in the 34th nailed column across the strip.
The corners fall on lattice columns that carry no nail, so nails either side of a corner are two steps apart.

Two readings of the source files are assumptions, each made in one place:

- **Mounting point.** A plate hangs with the centre of its artboard on the nail and turns about it. The artboard is exactly one cell of the nail lattice (17.5 × 16.875 in), which is why. When real connection points exist, they replace the artboard centre in `tools/plates.mjs`.
- **Designated top.** The upward direction of the artboard.

## Growth rules

The rules live in `src/engine.js` and nowhere else.
The exhibition is a fold over 157 daily readings; a decision depends only on the readings up to its day.

1. **Family** — the hue sector of the reading. If that family is used up, the next sector round the wheel stands in.
2. **Plate** — the unused plate in that family whose area, branch count, elongation and density, as ranks within the archive, lie closest to the reading's target profile.
3. **Position** — day 1 takes the nail at the centre of the longest wall. Every later day takes a free nail next to the existing mass. The phase decides which relationships are permitted; among the permitted nails, growth energy sets how far from the composition's centre to reach and magnetic bias sets the direction.
4. **Orientation** — the reading's position inside its hue sector, in 15° steps.

A relationship is a statement about the lattice, not a label: the number of installed plates on the eight surrounding nails, whether they form one group or several (several means the new plate closes a loop), or, for a bridge, an installed plate two steps away with nothing between.
Phase 1 allows one or two neighbours within four nails of the initial node, phase 2 adds three- and four-way junctions, phase 3 adds loop closures and cluster infill, phase 4 adds bridges.

Not modelled yet: collisions between the actual silhouettes of neighbouring plates, and stacking more than one plate on a nail.
