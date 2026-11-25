const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../public/js/app/admin-ui.js"), "utf8");

class Element {
  children = [];
  attributes = {};
  listeners = {};

  constructor(tag) {
    this.tag = tag;
  }

  append(child) {
    this.children.push(child);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  closest(selectors) {
    return selectors.split(", ").includes(this.tag) ? this : null;
  }

  dispatch(type, { target = this, key } = {}) {
    let prevented = false;
    this.listeners[type]?.({
      target,
      currentTarget: this,
      key,
      preventDefault: () => { prevented = true; },
    });
    return prevented;
  }
}

test("admin table rows open on one click, Enter or Space", () => {
  const document = {
    createElement: (tag) => new Element(tag),
    addEventListener() {},
  };
  const window = { matchMedia: () => ({ matches: false }) };
  vm.runInNewContext(source, { document, window, Node: Element });

  const fixture = { id: 1, name: "Sample student" };
  const container = new Element("div");
  container.id = "usersTable";
  const opened = [];
  window.SWAPPR.adminUi.createTable({
    container,
    columns: [{ key: "name", label: "Name" }],
    defaultSort: { key: "name", dir: "asc" },
    onOpen: (row) => opened.push(row),
  }).setRows([fixture]);

  const body = container.children[0].children[1];
  const [row] = body.children;
  assert.equal(row.attributes.tabindex, "0");

  row.dispatch("click", { target: row.children[0] });
  assert.deepEqual(opened, [fixture]);
  row.dispatch("dblclick");
  row.dispatch("click", { target: new Element("a") });
  row.dispatch("keydown", { target: new Element("button"), key: "Enter" });
  assert.deepEqual(opened, [fixture]);

  for (const key of ["Enter", " "]) {
    assert.equal(row.dispatch("keydown", { key }), true);
  }
  assert.deepEqual(opened, [fixture, fixture, fixture]);
});
