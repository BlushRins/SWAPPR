// Static checks for the sign-in page and shared design tokens: every field
// has an accessible name, the registration dialog stays a real dialog, and
// the token colors keep WCAG AA contrast.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const read = (file) => readFileSync(path.join(__dirname, "..", "public", file), "utf8");
const loginHtml = read("login.html");
const tokensCss = read("css/tokens.css");

function luminance(hex) {
  const channels = hex.match(/\w\w/g).map((pair) => parseInt(pair, 16) / 255);
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// Reads `--name: #hex` pairs from one CSS block, e.g. ":root {" or ".dark {".
function tokens(blockStart) {
  const start = tokensCss.indexOf(blockStart);
  assert.notEqual(start, -1, `tokens.css has a ${blockStart} block`);
  const block = tokensCss.slice(start, tokensCss.indexOf("}", start));
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*#([0-9a-f]{6})/gi)].map(([, name, hex]) => [name, hex]),
  );
}

test("every sign-in and registration field has an accessible name", () => {
  // The sign-in design shows placeholders, so each field also carries a name
  // that stays when the placeholder disappears.
  const inputs = [...loginHtml.matchAll(/<input\b[^>]*>/g)].map(([tag]) => tag);
  assert.ok(inputs.length > 0);
  for (const tag of inputs) {
    if (/aria-label="[^"]+"/.test(tag)) continue;
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    assert.ok(id, `input has an id: ${tag}`);
    assert.match(loginHtml, new RegExp(`<label[^>]*for="${id}"`), `#${id} has a <label> or aria-label`);
  }
});

test("registration shows the derived student ID as an email description", () => {
  assert.doesNotMatch(loginHtml, /<input\b[^>]*id="regStudentId[^"]*"/);
  assert.match(loginHtml, /id="regEmail"[^>]*aria-describedby="[^"]*\bregStudentIdPreview\b/);
  assert.match(loginHtml, /<p id="regStudentIdPreview"[^>]* hidden><\/p>/);
});

test("registration is a labelled modal dialog with named steps", () => {
  assert.match(loginHtml, /role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="registerTitle"/s);
  assert.match(loginHtml, /id="regStepLabel"[^>]*>\s*Step 1 of 2: Account details/);
  assert.match(read("js/login.js"), /Step 2 of 2: Verify your USC email/);
});

test("every page loads the shared tokens before its own stylesheet", () => {
  for (const [page, own] of [
    ["login.html", "login_styles.css"],
    ["index.html", "styles.css"],
    ["profile.html", "styles.css"],
    ["admin.html", "styles.css"],
  ]) {
    const html = read(page);
    const tokensAt = html.indexOf('href="css/tokens.css"');
    assert.notEqual(tokensAt, -1, `${page} links tokens.css`);
    assert.ok(tokensAt < html.indexOf(`href="css/${own}"`), `${page} links tokens.css first`);
  }
  assert.match(tokensCss, /:focus-visible\s*{[^}]*outline:\s*3px solid/);
  assert.match(tokensCss, /@media \(prefers-reduced-motion: reduce\)/);
});

for (const [theme, block] of [["light", ":root {"], ["dark", ".dark {"]]) {
  test(`${theme} tokens meet WCAG AA contrast`, () => {
    const t = tokens(block);
    const surface = t["color-surface"];
    for (const name of ["color-text", "color-text-muted", "color-placeholder", "color-error"]) {
      assert.ok(contrast(t[name], surface) >= 4.5, `${name} on surface >= 4.5:1`);
    }
    assert.ok(contrast(t["color-text"], t["color-canvas"]) >= 4.5, "text on canvas >= 4.5:1");
    assert.ok(contrast(t["color-border"], surface) >= 3, "field border on surface >= 3:1");
    assert.ok(contrast(t["color-focus"], surface) >= 3, "focus ring on surface >= 3:1");
    assert.ok(contrast(t["color-on-primary"], t["color-primary"]) >= 4.5, "button text >= 4.5:1");
  });
}

test("dark app fields keep a readable placeholder and visible boundary", () => {
  // styles.css paints dark fields #1e1b4b and takes both colors from tokens.
  const dark = tokens(".dark {");
  const styles = read("css/styles.css");
  assert.match(styles, /\.dark \.input-field::placeholder\s*{\s*color:\s*var\(--color-placeholder\)/);
  assert.ok(contrast(dark["color-placeholder"], "1e1b4b") >= 4.5);
  assert.ok(contrast(dark["color-border"], "1e1b4b") >= 3);
});

test("browse has one labelled search and a secondary degree-program control", () => {
  const index = read("index.html");
  assert.match(index, /<label id="searchLabel" for="searchInput"[^>]*>\s*Search by subject name or code/);
  assert.match(index, /<details id="programPicker"[^>]*>\s*<summary>Change degree program<\/summary>/);
  assert.match(index, /<label for="programSearch"[^>]*>Degree program<\/label>/);
  assert.doesNotMatch(read("js/app/subjects.js"), /View Swaps/);
  assert.match(read("js/app/subjects.js"), /"View notebooks"/);
});

test("the phone menu reaches Add notebook, Profile and Swaps", () => {
  const index = read("index.html");
  const menu = index.match(/<nav\s+id="mobileMenu"[\s\S]*?<\/nav>/)[0];
  assert.match(menu, /data-action="mobile-add-notebook"[\s\S]*?Add notebook/);
  assert.match(menu, /data-action="mobile-profile"[\s\S]*?Profile/);
  assert.match(menu, /data-filter="requests"[\s\S]*?Swaps[\s\S]*?data-requests-badge/);
  const header = index.match(/<header[\s\S]*?<\/header>/)[0];
  assert.match(header, /data-filter="requests" class="swaps-shortcut">[\s\S]*?Swaps[\s\S]*?data-requests-badge/);
  assert.doesNotMatch(index, /data-filter="matched"|My swaps/);
  assert.equal((index.match(/data-filter="requests"/g) || []).length, 3);
});

test("notebook actions say Open notebook and Request swap", () => {
  const notebooks = read("js/app/notebooks.js");
  assert.match(notebooks, /Open notebook/);
  assert.match(notebooks, /Request swap/);
  assert.doesNotMatch(notebooks, /UNLOCK VIA SWAP/);
});

test("publishing groups optional counts and explains the file link", () => {
  const index = read("index.html");
  const form = index.slice(index.indexOf('id="addModal"'), index.indexOf('id="portfolioActionBtn"'));
  const details = form.match(/<details id="optionalNotebookDetails"[\s\S]*?<\/details>/)?.[0];
  assert.ok(details, "counts sit in an Optional notebook details disclosure");
  assert.match(details, /<summary>Optional notebook details<\/summary>/);
  for (const id of ["newWordCount", "newPageCount", "newDiagramCount"]) {
    assert.match(details, new RegExp(`id="${id}"`));
  }
  const order = ["newTitle", "newSubject", "newFileUrl", "optionalNotebookDetails"].map((id) =>
    form.indexOf(`id="${id}"`),
  );
  assert.deepEqual([...order].sort((a, b) => a - b), order, "title, subject and link come first");
  assert.match(form, /id="newFileUrlHint"[^>]*>[\s\S]*anyone with the link can\s+view/);
  for (const id of ["newTitle", "newSubject", "newFileUrl", "newDescription"]) {
    assert.match(form, new RegExp(`<label for="${id}"`), `#${id} has a label`);
  }
});

test("the profile shows notebooks before About, under a short header", () => {
  const profile = read("profile.html");
  assert.ok(profile.indexOf('id="notebooksList"') < profile.indexOf('id="aboutCard"'));
  assert.match(profile, /\.cover \{\s*height: 88px;/);
});

test("admin status labels are words in sentence case", () => {
  const adminUi = read("js/app/admin-ui.js");
  assert.match(adminUi, /under_review: \["Under review"/);
  assert.match(adminUi, /Sorted by \$\{column\.label\}/);
});
