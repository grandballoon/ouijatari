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
| `src/index.html` | The real page. **Gitignored** — never commit it. |
| `index.html` | Generated. Encrypted payload + gate. This is what ships. |
| `tools/gate.html` | Gate template; holds the browser-side decryptor. |
| `tools/encrypt.mjs` | `src/index.html` → `index.html`. |
| `tools/decrypt.mjs` | `index.html` → `src/index.html`. |
| `tools/lib.mjs` | Shared crypto, used by both scripts. |
| `tools/test.mjs` | Checks the browser and Node implementations agree. |

Requires Node 18+. There are no dependencies.

## Editing the page

```sh
node tools/decrypt.mjs      # if you have no src/index.html yet
$EDITOR src/index.html
node tools/encrypt.mjs      # regenerate index.html
node tools/test.mjs
git commit -am "Update page" && git push
```

Both scripts prompt for the passphrase without echoing it.
For non-interactive use, set `OUIJATARI_PASSWORD` — prefer a leading space or
your shell's history-off setting so it does not land in shell history.

Because `src/` is gitignored, the encrypted `index.html` is the versioned copy
of record; `tools/decrypt.mjs` is how you get an editable source back on a new
machine. Keep the passphrase in a password manager — if it is lost, the page
is unrecoverable.

## Changing the passphrase

Re-run `node tools/encrypt.mjs` with the new one and push. Anyone with the old
passphrase can still decrypt any copy of the old `index.html` they kept, so
rotation limits future access, not past access.
