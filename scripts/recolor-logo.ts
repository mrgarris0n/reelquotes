/**
 * Recolor the logo so it works on the dark page background.
 *
 * Source palette (the original logo):
 *   - cream background (~ R+G+B above 700)
 *   - dark navy camera body (B clearly > R)
 *   - gold quote marks (R > B)
 *
 * Target palette (dark theme):
 *   - cream  → transparent
 *   - navy   → zinc-100 (#e4e4e7)
 *   - gold   → amber-700 (#b45309) — dark enough to stand out from the
 *             light camera body
 *
 * Pixels at edges (anti-aliased) get a smooth alpha based on cream-ness
 * so the output has clean, soft edges on the dark background.
 */

import sharp from "sharp";
import path from "node:path";

const SRC = path.join(process.cwd(), "public", "logo.png");
const DST = path.join(process.cwd(), "public", "logo-dark.png");

async function main(): Promise<void> {
  const img = sharp(SRC).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`expected 4 channels, got ${info.channels}`);

  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    const aIn = out[i + 3];

    // 0 = pure cream (background), 1 = no cream
    // Cream is roughly (245, 240, 225). We measure how close to that.
    const dr = (r - 245) / 255;
    const dg = (g - 240) / 255;
    const db = (b - 225) / 255;
    const distFromCream = Math.sqrt(dr * dr + dg * dg + db * db);
    // Anything within ~20% of cream → fully transparent. Past ~35% → fully opaque.
    const opacity = Math.min(1, Math.max(0, (distFromCream - 0.2) / 0.15));

    // Classify the foreground hue: navy if blueish, gold if warm.
    const isNavy = b > r;
    if (isNavy) {
      out[i] = 0xe4;
      out[i + 1] = 0xe4;
      out[i + 2] = 0xe7;
    } else {
      out[i] = 0xb4;
      out[i + 1] = 0x53;
      out[i + 2] = 0x09;
    }
    out[i + 3] = Math.round(aIn * opacity);
  }

  await sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toFile(DST);

  console.log(`Wrote ${DST} (${info.width}x${info.height})`);
}

void main();
