// After `next build` with output:"standalone", copy static assets and public into the standalone
// folder so `node .next/standalone/server.js` serves them (BRD §10 "known trap on this stack").
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
if (!fs.existsSync(standalone)) {
  console.error("No .next/standalone folder — did `next build` run with output: 'standalone'?");
  process.exit(1);
}
const copies = [
  [path.join(root, ".next", "static"), path.join(standalone, ".next", "static")],
  [path.join(root, "public"), path.join(standalone, "public")],
];
for (const [from, to] of copies) {
  if (!fs.existsSync(from)) continue;
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`copied ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}
