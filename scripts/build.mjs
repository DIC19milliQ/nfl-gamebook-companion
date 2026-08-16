import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "..");
const distRoot = resolve(projectRoot, "dist");
const assetsRoot = resolve(distRoot, "assets");

await mkdir(assetsRoot, { recursive: true });

await build({
  entryPoints: [resolve(projectRoot, "src/main.tsx")],
  outfile: resolve(assetsRoot, "app.js"),
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  jsx: "automatic",
  loader: { ".css": "css" },
  legalComments: "none",
});

const sourceHtml = await readFile(resolve(projectRoot, "index.html"), "utf8");
const outputHtml = sourceHtml
  .replace('<script type="module" src="/src/main.tsx"></script>', '<link rel="stylesheet" href="./assets/app.css" />\n    <script type="module" src="./assets/app.js"></script>');
await writeFile(resolve(distRoot, "index.html"), outputHtml, "utf8");

await copyFile(resolve(projectRoot, "fixtures/colts-at-patriots-2026-08-13.pdf"), resolve(distRoot, "colts-at-patriots-2026-08-13.pdf"));
await copyFile(resolve(projectRoot, "fixtures/pdf.worker.min.mjs"), resolve(distRoot, "pdf.worker.min.mjs"));

console.log("Built dist/ with the app, local PDF.js worker, and regression fixture.");
