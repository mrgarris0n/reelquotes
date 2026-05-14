import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import type { RoundState, ScoreState } from "./types";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

const MIN_SECRET_LEN = 16;

function loadKey(): Buffer {
  const secret = process.env.REELQUOTES_SECRET;
  if (secret && secret.length >= MIN_SECRET_LEN) {
    return createHash("sha256").update(secret).digest();
  }
  const g = globalThis as unknown as {
    __reelquotesKey?: Buffer;
    __reelquotesSecretWarned?: true;
  };
  if (!g.__reelquotesKey) {
    g.__reelquotesKey = randomBytes(32);
  }
  if (process.env.NODE_ENV === "production" && !g.__reelquotesSecretWarned) {
    g.__reelquotesSecretWarned = true;
    if (!secret) {
      console.warn(
        "REELQUOTES_SECRET is not set — using a per-process key. Tokens issued by one Lambda instance will be rejected by another. Set REELQUOTES_SECRET in your Vercel project env vars (≥32 random hex bytes).",
      );
    } else {
      console.warn(
        `REELQUOTES_SECRET is too short (${secret.length} chars, need ≥${MIN_SECRET_LEN}) — falling back to a per-process key. Tokens will break across Lambda instances. Use 32 random hex bytes.`,
      );
    }
  }
  return g.__reelquotesKey;
}

function encrypt<T>(data: T): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, loadKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

function decrypt<T>(token: string): T | null {
  try {
    const buf = Buffer.from(token, "base64url");
    if (buf.length < IV_LEN + TAG_LEN + 1) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const dec = createDecipheriv(ALGO, loadKey(), iv);
    dec.setAuthTag(tag);
    const out = Buffer.concat([dec.update(enc), dec.final()]).toString("utf8");
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

export const encodeRound = (s: RoundState): string => encrypt(s);
export const decodeRound = (t: string): RoundState | null => decrypt<RoundState>(t);

export const encodeScore = (s: ScoreState): string => encrypt(s);
export const decodeScore = (t: string): ScoreState | null => decrypt<ScoreState>(t);
