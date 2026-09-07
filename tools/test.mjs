#!/usr/bin/env node
// Verifies that the browser decryptor in tools/gate.html agrees with the Node
// encryptor in tools/lib.mjs. These are two independent implementations of the
// same format, so a change to one that is not mirrored in the other would ship
// an undecryptable page. Run: node tools/test.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";
import { encrypt, decrypt } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gate = await readFile(join(root, "tools", "gate.html"), "utf8");

// Lift the shipped functions out of gate.html so the browser code itself is
// under test, not a re-typed copy of it.
function lift(name) {
  const re = new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`);
  const found = gate.match(re);
  assert.ok(found, `could not extract ${name}() from tools/gate.html`);
  return found[0];
}

function browserDecryptorFor(payload) {
  const body = `
    const crypto = arguments[0], atob = arguments[1], PAYLOAD = arguments[2];
    ${lift("b64")}
    ${lift("decrypt")}
    return decrypt;
  `;
  return new Function(body)(
    webcrypto,
    (s) => Buffer.from(s, "base64").toString("binary"),
    payload
  );
}

const PASSWORD = "correct horse battery staple";
// Multi-byte and HTML-significant characters, to catch encoding mistakes.
const FIXTURE = '<!doctype html><p>Ouijatari — plate #184, 90° · "overlap" & <b>grow</b> ☉</p>';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("gate.html still has its payload placeholder", () => {
  assert.ok(gate.includes("__PAYLOAD__"), "tools/gate.html lost __PAYLOAD__");
});

test("browser decrypts what Node encrypts", async () => {
  const payload = await encrypt(FIXTURE, PASSWORD);
  assert.equal(await browserDecryptorFor(payload)(PASSWORD), FIXTURE);
});

test("browser rejects a wrong passphrase", async () => {
  const payload = await encrypt(FIXTURE, PASSWORD);
  await assert.rejects(() => browserDecryptorFor(payload)("nope"));
});

test("Node round-trips its own output", async () => {
  const payload = await encrypt(FIXTURE, PASSWORD);
  assert.equal(await decrypt(payload, PASSWORD), FIXTURE);
});

test("each encryption uses a fresh salt and IV", async () => {
  const [a, b] = await Promise.all([
    encrypt(FIXTURE, PASSWORD),
    encrypt(FIXTURE, PASSWORD),
  ]);
  assert.notEqual(a.kdf.salt, b.kdf.salt, "salt must not repeat");
  assert.notEqual(a.iv, b.iv, "IV must not repeat");
  assert.notEqual(a.ct, b.ct, "ciphertext must not repeat");
});

test("tampered ciphertext is rejected", async () => {
  const payload = await encrypt(FIXTURE, PASSWORD);
  const raw = Buffer.from(payload.ct, "base64");
  raw[0] ^= 0xff;
  payload.ct = raw.toString("base64");
  await assert.rejects(() => decrypt(payload, PASSWORD), "GCM must reject a forged payload");
});

test("payload is safe to inline in a <script> tag", async () => {
  const payload = await encrypt(FIXTURE, PASSWORD);
  const json = JSON.stringify(payload);
  assert.ok(!json.includes("</"), "payload must not contain a tag terminator");
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
