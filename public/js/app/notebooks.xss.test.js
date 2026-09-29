// Run: node public/js/app/notebooks.xss.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "notebooks.js"), "utf8");
const profilePanelSource = fs.readFileSync(
  path.join(__dirname, "profile-panel.js"),
  "utf8",
);

assert.ok(
  !source.includes("${notebook.title"),
  "notebook titles must not be interpolated into innerHTML",
);

assert.ok(
  !source.includes("${displayDesc"),
  "notebook descriptions must not be interpolated into innerHTML",
);

assert.ok(
  !source.includes("${notebook.username"),
  "notebook usernames must not be interpolated into innerHTML",
);

assert.ok(
  !profilePanelSource.includes("@${username}</div>"),
  "profile match usernames must not be interpolated into innerHTML",
);

const chatSource = fs.readFileSync(path.join(__dirname, "chat.js"), "utf8");

assert.ok(
  !chatSource.includes(".innerHTML"),
  "chat messages must be rendered with textContent, not innerHTML",
);

const detailsSource = fs.readFileSync(path.join(__dirname, "notebook-details.js"), "utf8");

assert.ok(
  !detailsSource.includes("innerHTML"),
  "Notebook Details must render notebook text with textContent, not innerHTML",
);

console.log("notebooks.xss.test.js OK");
