// Generate PNG favicon variants from public/logo.svg using sharp.
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";

const svg = await readFile("/home/z/my-project/public/logo.svg");

const targets = [
  { file: "/home/z/my-project/public/apple-icon.png", size: 180 },
  { file: "/home/z/my-project/public/icon-32.png", size: 32 },
  { file: "/home/z/my-project/public/icon-192.png", size: 192 },
  { file: "/home/z/my-project/public/icon-512.png", size: 512 },
];

for (const { file, size } of targets) {
  const buf = await sharp(svg, { density: 512 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(file, buf);
  console.log(`wrote ${file} (${size}x${size}, ${buf.length} bytes)`);
}
