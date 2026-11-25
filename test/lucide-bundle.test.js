const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const { icons: upstream } = require("lucide");

test("the generated Lucide bundle includes every icon used in public pages", () => {
  const publicDir = join(__dirname, "../public");
  const bundlePath = "js/vendor/lucide.js";
  const window = {};
  runInNewContext(readFileSync(join(publicDir, bundlePath), "utf8"), { window });
  assert.equal(typeof window.lucide.createIcons, "function");

  // Names constructed by the theme, mobile menu and notebook renders.
  const required = new Set([
    "sun", "moon", "x", "menu", "file-text", "image", "book-open", "clock", "pencil", "trash-2",
    "triangle-alert", "user-check", "user-x", "circle-slash", "shield-x",
  ]);
  for (const entry of readdirSync(publicDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:html|js)$/.test(entry.name)) continue;
    const file = join(entry.parentPath, entry.name);
    if (file === join(publicDir, bundlePath)) continue;
    const source = readFileSync(file, "utf8");
    const references = source.matchAll(/(?:data-lucide\s*=|\.lucide\s*=|["']data-lucide["']\s*,|\bicon\s*:|ui\.icon\()\s*["']([a-z0-9-]+)["']/g);
    for (const [, name] of references) required.add(name);
  }

  for (const name of required) {
    const key = name.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("");
    assert.ok(Object.hasOwn(window.lucide.icons, key), `Missing icon: ${name}`);
    assert.equal(JSON.stringify(window.lucide.icons[key]), JSON.stringify(upstream[key]), name);
  }
});
