// Shared crypto + password-prompt helpers for the encrypt/decrypt scripts.
// Format v1: PBKDF2-SHA256 -> AES-256-GCM, mirrored by the in-browser decryptor
// in tools/gate.html. Any change here must be made there too.
import { webcrypto as crypto } from "node:crypto";
import readline from "node:readline";

export const FORMAT_VERSION = 1;
export const KDF_HASH = "SHA-256";
export const KDF_ITERATIONS = 600000; // OWASP 2023 guidance for PBKDF2-SHA256
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

async function deriveKey(password, salt, iterations, usage) {
  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: KDF_HASH },
    base, { name: "AES-GCM", length: 256 }, false, [usage]
  );
}

export async function encrypt(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, KDF_ITERATIONS, "encrypt");
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)
  );
  return {
    v: FORMAT_VERSION,
    kdf: {
      name: "PBKDF2",
      hash: KDF_HASH,
      iterations: KDF_ITERATIONS,
      salt: Buffer.from(salt).toString("base64"),
    },
    iv: Buffer.from(iv).toString("base64"),
    ct: Buffer.from(ct).toString("base64"),
  };
}

export async function decrypt(payload, password) {
  if (payload.v !== FORMAT_VERSION) {
    throw new Error(`Unsupported payload version ${payload.v} (expected ${FORMAT_VERSION}).`);
  }
  const salt = Buffer.from(payload.kdf.salt, "base64");
  const key = await deriveKey(password, salt, payload.kdf.iterations, "decrypt");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(payload.iv, "base64") },
    key, Buffer.from(payload.ct, "base64")
  );
  return new TextDecoder().decode(plain);
}

// Reads a passphrase without echoing it, so it never lands in shell history.
export function promptPassword(label) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error(
        "No TTY available for the passphrase prompt. Set OUIJATARI_PASSWORD instead."
      ));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    const write = rl.output.write.bind(rl.output);
    rl.output.write = (chunk, ...rest) => (muted ? true : write(chunk, ...rest));
    rl.question(`${label}: `, (answer) => {
      muted = false;
      rl.output.write("\n");
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

export async function readPassword({ confirm = false } = {}) {
  const fromEnv = process.env.OUIJATARI_PASSWORD;
  if (fromEnv) return fromEnv;
  const password = await promptPassword("Passphrase");
  if (!password) throw new Error("Passphrase must not be empty.");
  if (confirm) {
    const again = await promptPassword("Confirm passphrase");
    if (again !== password) throw new Error("Passphrases did not match.");
  }
  return password;
}
