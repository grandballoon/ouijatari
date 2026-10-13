#!/usr/bin/env node
// Encrypts the page in src/ into the published, committable index.html.
// The local scripts src/index.html loads are folded in first (tools/bundle.mjs).
//
//   node tools/encrypt.mjs            # prompts for the passphrase
//   OUIJATARI_PASSWORD=… node tools/encrypt.mjs
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { encrypt, readPassword } from "./lib.mjs";
import { inline } from "./bundle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, "src", "index.html");
const TEMPLATE = join(root, "tools", "gate.html");
const OUTPUT = join(root, "index.html");
const PLACEHOLDER = "__PAYLOAD__";

const [page, template] = await Promise.all([
  readFile(SOURCE, "utf8"),
  readFile(TEMPLATE, "utf8"),
]);
const source = await inline(page, (name) => readFile(join(root, "src", name), "utf8"));

if (!template.includes(PLACEHOLDER)) {
  throw new Error(`tools/gate.html is missing the ${PLACEHOLDER} placeholder.`);
}

const password = await readPassword({ confirm: true });
const payload = await encrypt(source, password);
const json = JSON.stringify(payload);

// A literal replacement: base64/JSON never contains "$&", but be explicit.
const output = template.replace(PLACEHOLDER, () => json);
await writeFile(OUTPUT, output);

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(`src/            ${kb(Buffer.byteLength(source))} plaintext, bundled`);
console.log(`index.html      ${kb(Buffer.byteLength(output))} encrypted`);
console.log(`\nWrote index.html. Commit it and push to publish.`);
