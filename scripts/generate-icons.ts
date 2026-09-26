// Génère les icônes PNG de la PWA à partir de public/favicon.svg.
import fs from "node:fs";
import sharp from "sharp";

const svg = fs.readFileSync("public/favicon.svg");
// Maskable : le motif doit tenir dans la zone sûre (80 %) sur fond plein.
const maskable = Buffer.from(
  svg.toString().replace('<rect width="512" height="512" rx="112" fill="#2f6b4f"/>', '<rect width="512" height="512" fill="#2f6b4f"/><g transform="translate(51 51) scale(0.8)">').replace("</svg>", "</g></svg>"),
);

await sharp(svg).resize(192, 192).png().toFile("public/icon-192.png");
await sharp(svg).resize(512, 512).png().toFile("public/icon-512.png");
await sharp(maskable).resize(512, 512).png().toFile("public/icon-maskable-512.png");
await sharp(maskable).resize(180, 180).flatten({ background: "#2f6b4f" }).png().toFile("public/apple-touch-icon.png");
console.log("Icônes générées dans public/");
