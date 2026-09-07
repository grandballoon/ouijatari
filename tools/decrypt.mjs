#!/usr/bin/env node
// Recovers src/index.html from the committed, encrypted index.html.
// The ciphertext is the versioned copy of record, so this is how you get an
// editable source back on a machine that does not already have one.
//
//   node tools/decrypt.mjs            # prompts, writes src/index.html
//   node tools/decrypt.mjs --stdout   # prints the plaintext instead
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decrypt, readPassword } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = join(root, "index.html");
const OUTPUT = join(root, "src", "index.html");
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
  await writeFile(OUTPUT, plaintext);
  console.error(`Wrote src/index.html (${(Buffer.byteLength(plaintext) / 1024).toFixed(1)} kB).`);
}
