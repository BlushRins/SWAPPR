const { readFileSync, readdirSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const { buildSync } = require("esbuild");
const { icons } = require("lucide");

const publicDir = resolve(__dirname, "../public");
const output = join(publicDir, "js/vendor/lucide.js");
const sources = [
  ...readdirSync(publicDir).filter((name) => name.endsWith(".html"))
    .map((name) => join(publicDir, name)),
  ...readdirSync(join(publicDir, "js"), { recursive: true }).filter((name) => name.endsWith(".js"))
    .map((name) => join(publicDir, "js", name)).filter((file) => file !== output),
];

const names = new Set();
for (const file of sources) {
  const source = readFileSync(file, "utf8");
  for (const [, name] of source.matchAll(/\bdata-lucide\s*=\s*["']([^"'\r\n]*)["']/g)) {
    if (!name.includes("${")) names.add(name);
  }
  for (const [, name] of source.matchAll(/(?:\.dataset\.lucide\s*=\s*|\.setAttribute\(\s*["']data-lucide["']\s*,\s*)["']([^"'\r\n]*)["']/g)) {
    names.add(name);
  }
  // Admin controls and notebook metric pills declare Lucide names as icon properties.
  for (const [, name] of source.matchAll(/(?:\bicon\s*:\s*|\bui\.icon\(\s*)["']([^"'\r\n]*)["']/g)) {
    names.add(name);
  }
  // Dynamic names are declared beside their source in the browser code.
  for (const [, list] of source.matchAll(/^\s*\/\/ lucide-icons: ([\w -]+)$/gm)) {
    for (const name of list.trim().split(/\s+/)) names.add(name);
  }
}

const exportsUsed = [...names].sort().map((name) => {
  const exportName = name.replace(/(^|-)([a-z0-9])/g, (_, separator, char) => char.toUpperCase());
  if (!Object.hasOwn(icons, exportName)) throw new Error(`Unknown Lucide icon: ${name}`);
  return exportName;
});
const lucideDir = resolve(dirname(require.resolve("lucide")), "../..");
const license = readFileSync(join(lucideDir, "LICENSE"), "utf8");

buildSync({
  stdin: {
    // Use Lucide's renderer so SVG attributes, aliases and accessibility match upstream.
    contents: `
      import { createIcons, ${exportsUsed.join(", ")} } from "lucide";
      const icons = { ${exportsUsed.join(", ")} };
      window.lucide = { icons, createIcons: (options) => createIcons({ icons, ...options }) };
    `,
    resolveDir: dirname(publicDir),
  },
  outfile: output,
  bundle: true,
  minify: true,
  legalComments: "none",
  banner: { js: `/*!\n${license.trimEnd()}\n*/` },
});
