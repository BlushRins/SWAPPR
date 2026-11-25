// Keyboard focus for popups (js/actions.js layers, js/mobile-menu.js): the
// closed phone menu takes no Tab stops, an open popup keeps the rest of the
// page inert, and closing one puts focus back where it was. Runs the real
// scripts against a tiny fake DOM, so it needs no browser.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const FOCUSABLE_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);

// Matches the simple selectors the scripts use: tag, [attr] and [attr="v"].
function matchOne(node, selector) {
  if (selector.includes(":")) return false;
  const tag = selector.match(/^[a-z]+/)?.[0];
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (name === "inert" ? !node.inert : !(name in node.attrs)) return false;
    if (value !== undefined && node.attrs[name] !== value) return false;
  }
  return true;
}

function makeDom() {
  const document = { activeElement: null, listeners: {} };
  class El {
    constructor(tag, attrs = {}, ...children) {
      this.tagName = tag.toUpperCase();
      this.attrs = { ...attrs };
      this.children = [];
      this.parentElement = null;
      this.inert = false;
      this.dataset = {};
      const classes = new Set();
      this.classList = {
        toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        contains: (name) => classes.has(name),
      };
      children.forEach((child) => this.append(child));
    }
    append(child) {
      child.parentElement = this;
      this.children.push(child);
    }
    get isConnected() {
      let node = this;
      while (node.parentElement) node = node.parentElement;
      return node === document.body;
    }
    get tabIndex() {
      if ("tabindex" in this.attrs) return Number(this.attrs.tabindex);
      return FOCUSABLE_TAGS.has(this.tagName) ? 0 : -1;
    }
    set tabIndex(value) {
      this.attrs.tabindex = String(value);
    }
    contains(node) {
      for (let current = node; current; current = current.parentElement) {
        if (current === this) return true;
      }
      return false;
    }
    matches(selectors) {
      return selectors.split(",").some((selector) => matchOne(this, selector.trim()));
    }
    closest(selectors) {
      for (let current = this; current; current = current.parentElement) {
        if (current.matches(selectors)) return current;
      }
      return null;
    }
    querySelectorAll(selectors) {
      const found = [];
      const walk = (node) =>
        node.children.forEach((child) => {
          if (child.matches(selectors)) found.push(child);
          walk(child);
        });
      walk(this);
      return found;
    }
    querySelector(selectors) {
      return this.querySelectorAll(selectors)[0] || null;
    }
    getAttribute(name) {
      return this.attrs[name] ?? null;
    }
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    }
    hasAttribute(name) {
      return name in this.attrs;
    }
    getClientRects() {
      return [{}];
    }
    focus() {
      document.activeElement = this;
    }
  }
  const el = (tag, attrs, ...children) => new El(tag, attrs, ...children);

  const toggle = el("button", { id: "mobileMenuToggle" });
  const logo = el("button", {});
  const overlay = el("div", { id: "mobileMenuOverlay" });
  const firstItem = el("button", {});
  const menu = el("nav", { id: "mobileMenu" }, firstItem, el("a", { href: "#" }));
  const pageButton = el("button", {});
  const main = el("main", {}, pageButton);
  const drawerClose = el("button", {});
  const drawer = el("div", { id: "profilePanel" }, drawerClose);
  const dialogField = el("input", {});
  const dialog = el("div", { id: "reportModal" }, dialogField);
  const toast = el("div", { id: "toast", role: "status", "aria-live": "polite" });
  document.body = el(
    "body",
    {},
    el("header", {}, logo, el("div", {}, toggle)),
    overlay,
    menu,
    main,
    drawer,
    dialog,
    toast,
  );
  document.getElementById = (id) => document.body.querySelector(`[id="${id}"]`);
  document.querySelector = (selector) => document.body.querySelector(selector);
  document.querySelectorAll = (selector) => document.body.querySelectorAll(selector);
  document.addEventListener = (type, listener) => {
    (document.listeners[type] ||= []).push(listener);
  };
  document.press = (key, shiftKey = false) => {
    const event = { key, shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    (document.listeners.keydown || []).forEach((listener) => listener(event));
    return event;
  };

  const window = { matchMedia: () => ({ addEventListener() {} }), addEventListener() {} };
  const context = vm.createContext({ window, document, CSS: { escape: (value) => value } });
  for (const file of ["actions.js", "mobile-menu.js"]) {
    const source = readFileSync(path.join(__dirname, "..", "public", "js", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  return { window, document, app: window.SWAPPR, parts: { toggle, logo, overlay, menu, firstItem, main, pageButton, drawer, drawerClose, dialog, dialogField, toast } };
}

test("the closed phone menu is inert and opens and closes around its button", () => {
  const { window, document, parts } = makeDom();
  assert.equal(parts.menu.inert, true, "closed menu has no Tab stops");

  parts.toggle.focus();
  window.toggleMobileMenu();
  assert.equal(parts.menu.inert, false);
  assert.equal(document.activeElement, parts.firstItem, "focus moves to the first item");
  assert.equal(parts.main.inert, true, "the page behind the menu is inert");
  assert.equal(parts.logo.inert, true);
  assert.equal(parts.toggle.inert, false, "the toggle still closes the menu");
  assert.equal(parts.overlay.inert, false, "the backdrop still takes a click");
  assert.equal(parts.toast.inert, false, "status messages are still announced");

  // Tab wraps from the last item back to the toggle.
  document.activeElement = parts.menu.children[1];
  assert.equal(document.press("Tab").defaultPrevented, true);
  assert.equal(document.activeElement, parts.toggle);

  document.press("Escape");
  assert.equal(parts.menu.inert, true, "closed again");
  assert.equal(parts.main.inert, false, "the page is usable again");
  assert.equal(document.activeElement, parts.toggle, "focus returns to the toggle");
});

test("stacked popups return focus to the right place", () => {
  const { document, app, parts } = makeDom();
  app.registerDrawer(parts.drawer);
  assert.equal(parts.drawer.inert, true, "closed drawer has no Tab stops");

  parts.pageButton.focus();
  app.openLayer(parts.drawer);
  assert.equal(document.activeElement, parts.drawerClose);
  assert.equal(parts.main.inert, true);

  // A dialog opened from the drawer makes the drawer inert, then hands back.
  app.openLayer(parts.dialog, { focus: parts.dialogField });
  assert.equal(document.activeElement, parts.dialogField);
  assert.equal(parts.drawer.inert, true);
  app.closeLayer(parts.dialog);
  assert.equal(parts.drawer.inert, false);
  assert.equal(document.activeElement, parts.drawerClose);

  // Closing the drawer underneath an open dialog keeps focus in the dialog;
  // the dialog then returns focus to the drawer's own opener.
  app.openLayer(parts.dialog, { focus: parts.dialogField });
  app.closeLayer(parts.drawer);
  assert.equal(document.activeElement, parts.dialogField);
  assert.equal(parts.drawer.inert, true);
  app.closeLayer(parts.dialog);
  assert.equal(document.activeElement, parts.pageButton);
  assert.equal(parts.main.inert, false);
});
