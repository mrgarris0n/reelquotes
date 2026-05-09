import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import type { RoundState } from "./types";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function loadKey(): Buffer {
  const secret = process.env.REELQUOTES_SECRET;
  if (secret && secret.length >= 16) {
    return createHash("sha256").update(secret).digest();
  }
  const g = globalThis as unknown as { __reelquotesKey?: Buffer };
  if (!g.__reelquotesKey) {
    g.__reelquotesKey = randomBytes(32);
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "REELQUOTES_SECRET is not set — using a per-process key. Rounds may break across Lambda instances. Set REELQUOTES_SECRET in your Vercel project env vars (>=16 chars).",
      );
    }
  }
  return g.__reelquotesKey;
}

export function encodeRound(state: RoundState): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, loadKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decodeRound(token: string): RoundState | null {
  try {
    const buf = Buffer.from(token, "base64url");
    if (buf.length < IV_LEN + TAG_LEN + 1) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const dec = createDecipheriv(ALGO, loadKey(), iv);
    dec.setAuthTag(tag);
    const out = Buffer.concat([dec.update(enc), dec.final()]).toString("utf8");
    return JSON.parse(out) as RoundState;
  } catch {
    return null;
  }
}
