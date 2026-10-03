import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { AppError } from "./domain.js";

// Authenticated encryption for Bring-Your-Own-Key credentials.
// AES-256-GCM with a fresh 12-byte nonce per encryption and a server-only key
// supplied through AI_ENCRYPTION_KEY (base64 of exactly 32 random bytes).
// The API and worker MUST share the same secret or decryption will fail.
let cached: Buffer | null = null;
function serverKey(): Buffer {
  if (cached) return cached;
  const raw = process.env.AI_ENCRYPTION_KEY;
  if (!raw)
    throw new AppError(
      503,
      "ENCRYPTION_UNAVAILABLE",
      "Server encryption secret is not configured",
    );
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new AppError(
      503,
      "ENCRYPTION_UNAVAILABLE",
      "Server encryption secret is malformed",
    );
  }
  if (key.length !== 32)
    throw new AppError(
      503,
      "ENCRYPTION_UNAVAILABLE",
      "Server encryption secret must decode to 32 bytes",
    );
  cached = key;
  return key;
}

// AAD binds ciphertext to the owning user + credential identity + version so a
// row cannot be transplanted to another user or replayed across versions.
const aad = (parts: { userId: string; credentialId: string; version: number }) =>
  Buffer.from(`${parts.userId}:${parts.credentialId}:${parts.version}`, "utf8");

export function encryptKey(
  plaintext: string,
  parts: { userId: string; credentialId: string; version: number },
): { ciphertext: string; nonce: string } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", serverKey(), nonce);
  cipher.setAAD(aad(parts));
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Store tag appended to ciphertext so a single column round-trips cleanly.
  return {
    ciphertext: Buffer.concat([enc, tag]).toString("base64"),
    nonce: nonce.toString("base64"),
  };
}

export function decryptKey(
  ciphertext: string,
  nonce: string,
  parts: { userId: string; credentialId: string; version: number },
): string {
  const key = serverKey();
  const raw = Buffer.from(ciphertext, "base64");
  if (raw.length < 17)
    throw new AppError(422, "DECRYPT_FAILED", "Stored credential is corrupt");
  const tag = raw.subarray(raw.length - 16);
  const body = raw.subarray(0, raw.length - 16);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(nonce, "base64"),
  );
  decipher.setAAD(aad(parts));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    // Wrong user/version/key, or tampered ciphertext — never reveal plaintext.
    throw new AppError(
      422,
      "DECRYPT_FAILED",
      "Credential could not be decrypted for this owner",
    );
  }
}

// Last 4 characters of the key, for a non-reversible display hint only.
export const maskSuffix = (apiKey: string) =>
  apiKey.length <= 4 ? "••••" : "••••" + apiKey.slice(-4);

// Test-only reset so suites can swap AI_ENCRYPTION_KEY between cases.
export const _resetKeyCache = () => {
  cached = null;
};
