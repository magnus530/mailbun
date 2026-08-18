/**
 * Renders every icon asset from the single master SVG at build/icon.svg.
 *
 *   node scripts/gen-icons.mjs      (or: npm run icons)
 *
 * Outputs:
 *   build/icon.png              1024px  — electron-builder Linux icon
 *   build/icon.ico                      — electron-builder Windows icon
 *   build/icon.icns                     — electron-builder macOS icon
 *   client/public/icon.svg              — browser favicon (copy of master)
 *   client/public/logo.png       512px  — in-app logo
 *   client/public/apple-touch-icon.png  180px, opaque (iOS ignores alpha)
 *
 * Everything here is generated — edit build/icon.svg instead.
 */
import { readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import png2icons from "png2icons";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = (...parts) => path.join(root, ...parts);

const MASTER = p("build", "icon.svg");

/** Rasterise the master at `size`, honouring the SVG's own pixel density. */
const render = (svg, size) =>
  sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

const svg = await readFile(MASTER);

// png2icons builds both container formats from one large PNG; 1024 gives it
// enough to downsample every embedded size without artefacts.
const master1024 = await render(svg, 1024);

await writeFile(p("build", "icon.png"), master1024);

const ico = png2icons.createICO(master1024, png2icons.BILINEAR, 0, /* alpha */ true);
if (!ico) throw new Error("createICO returned null — is build/icon.svg valid?");
await writeFile(p("build", "icon.ico"), ico);

const icns = png2icons.createICNS(master1024, png2icons.BILINEAR, 0);
if (!icns) throw new Error("createICNS returned null — is build/icon.svg valid?");
await writeFile(p("build", "icon.icns"), icns);

await copyFile(MASTER, p("client", "public", "icon.svg"));
await writeFile(p("client", "public", "logo.png"), await render(svg, 512));

// iOS composites Apple touch icons onto black if they carry an alpha channel,
// so flatten onto the brand blue rather than shipping transparency.
await writeFile(
  p("client", "public", "apple-touch-icon.png"),
  await sharp(await render(svg, 180)).flatten({ background: "#1d4ed8" }).png().toBuffer(),
);

console.log("icons written from build/icon.svg");
