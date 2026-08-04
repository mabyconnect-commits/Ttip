import "server-only";
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Give the image renderer a font it can actually use.
 *
 * The first Telegram receipt went out as a grid of empty boxes. librsvg draws
 * text through fontconfig, fontconfig looks for fonts installed on the machine,
 * and a serverless runtime has none — so every glyph resolved to "missing
 * character". It rendered perfectly in development, where the machine has
 * fonts, which is exactly why it shipped.
 *
 * So the font travels with the code. DejaVu Sans is bundled in the repo
 * (Bitstream Vera licence — redistribution permitted), and this writes a
 * minimal fontconfig config pointing at it, into the one directory a serverless
 * function can write to.
 *
 * Nothing here depends on the host having a single font installed.
 */

const FAMILY = "DejaVu Sans";
let ready: string | null = null;

/** Where the bundled .ttf files ended up in the deployed bundle. */
function fontDir(): string | null {
  const candidates = [
    join(process.cwd(), "src/assets/fonts"),
    join(process.cwd(), ".next/server/src/assets/fonts"),
    join(process.cwd(), "assets/fonts"),
  ];
  for (const dir of candidates) {
    try {
      if (existsSync(dir) && readdirSync(dir).some((f) => f.toLowerCase().endsWith(".ttf"))) return dir;
    } catch {
      /* unreadable — try the next one */
    }
  }
  return null;
}

/**
 * Point fontconfig at the bundled font. Returns the family name to use, or null
 * when the fonts didn't make it into the bundle — in which case the caller must
 * NOT render an image, because it would be boxes again.
 *
 * Must run before the first render: fontconfig reads its environment once and
 * caches the result for the life of the process.
 */
export function ensureReceiptFont(): string | null {
  if (ready !== null) return ready || null;

  const dir = fontDir();
  if (!dir) {
    console.error("[receipt] bundled fonts not found — refusing to render text as boxes");
    ready = "";
    return null;
  }

  try {
    // /tmp is the only writable path in a serverless function.
    const confDir = join("/tmp", "ttip-fontconfig");
    mkdirSync(confDir, { recursive: true });
    writeFileSync(
      join(confDir, "fonts.conf"),
      `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>${dir}</dir>
  <cachedir>/tmp/ttip-fontcache</cachedir>
  <match target="pattern">
    <test qual="any" name="family"><string>sans-serif</string></test>
    <edit name="family" mode="assign" binding="same"><string>${FAMILY}</string></edit>
  </match>
</fontconfig>`,
    );
    mkdirSync("/tmp/ttip-fontcache", { recursive: true });
    process.env.FONTCONFIG_PATH = confDir;
    process.env.FONTCONFIG_FILE = join(confDir, "fonts.conf");
    ready = FAMILY;
    return FAMILY;
  } catch (e) {
    console.error("[receipt] could not configure fonts", e);
    ready = "";
    return null;
  }
}

export const RECEIPT_FONT = FAMILY;
