#!/usr/bin/env node
// Recovers src/ — index.html and the scripts bundled into it — from the
// committed, encrypted index.html.
// The ciphertext is the versioned copy of record, so this is how you get an
// editable source back on a machine that does not already have one.
//
//   node tools/decrypt.mjs            # prompts, writes src/
//   node tools/decrypt.mjs --stdout   # prints the bundled plaintext instead
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decrypt, readPassword } from "./lib.mjs";
import { extract } from "./bundle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = join(root, "index.html");
const OUTPUT = join(root, "src");
const toStdout = process.argv.includes("--stdout");

const published = await readFile(INPUT, "utf8");
const match = published.match(
  /<script type="application\/json" id="payload">([\s\S]*?)<\/script>/
);
if (!match) throw new Error("index.html does not contain an encrypted payload.");

const payload = JSON.parse(match[1]);
const password = await readPassword();

let plaintext;
try {
  plaintext = await decrypt(payload, password);
} catch (err) {
  console.error("Decryption failed — wrong passphrase, or the payload is corrupt.");
  process.exit(1);
}

if (toStdout) {
  process.stdout.write(plaintext);
} else {
  const { html, files } = extract(plaintext);
  await mkdir(OUTPUT, { recursive: true });
  for (const [name, text] of [["index.html", html], ...files]) {
    await writeFile(join(OUTPUT, name), text);
    console.error(`Wrote src/${name} (${(Buffer.byteLength(text) / 1024).toFixed(1)} kB).`);
  }
}
