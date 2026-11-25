const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(
  path.join(__dirname, "../public/js/app/swapp-request-modal.js"),
  "utf8",
);
const target = { id: 17, title: "Web Development Fundamentals", username: "marco" };
const own = { id: 23, title: "My notebook", username: "ana" };

function loadModal(notebooks = []) {
  let focused;
  const elements = new Map();
  const listeners = {};
  const sent = [];
  const app = {
    state: { currentUser: { username: "ana" }, notebooks: [target, ...notebooks] },
    openLayer: (_, { focus }) => focus.focus(),
    openAddModal: ({ onClose }) => { app.finishAdd = onClose; },
    sendSwapp: async (id, offered) => sent.push([id, Array.from(offered)]),
    loadSwapps: async () => {},
    loadNotebooks: async () => {},
    renderNotebooks() {},
    showToast() {},
  };
  function node(tag) {
    const classes = new Set();
    return {
      tag,
      children: [],
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
        toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
      },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(type, fn) { this[type] = fn; },
      querySelector() { return null; },
      focus() { focused = this; },
    };
  }
  function get(id) {
    if (!elements.has(id)) elements.set(id, node(id));
    return elements.get(id);
  }
  const checkboxes = () => get("swappRequestChoices").children.map((label) => label.children[0]);
  const document = {
    getElementById: get,
    createElement: node,
    addEventListener: (name, fn) => { listeners[name] = fn; },
    querySelectorAll: () => checkboxes().filter((checkbox) => checkbox.checked),
    querySelector: (selector) => selector.endsWith(":checked")
      ? document.querySelectorAll()[0]
      : checkboxes()[0],
  };
  vm.runInNewContext(source, { window: { SWAPPR: app }, document });
  listeners.DOMContentLoaded();
  app.openSwappRequestModal(target);
  return { app, get, checkboxes, focus: () => focused, sent };
}

test("a first request survives cancelled publishing and resumes with the published offer", async () => {
  const { app, get, checkboxes, focus, sent } = loadModal();
  const modal = get("swappRequestModal");
  const add = get("swappAddOfferBtn");
  const send = get("swappRequestSendBtn");
  assert.equal(get("swappRequestCancelBtn").textContent, "Keep browsing");
  assert.equal(focus(), add);
  await app.submitSwappRequest();
  assert.deepEqual(sent, []);

  add.click();
  assert.equal(modal.classList.contains("hidden"), true);
  app.finishAdd();
  assert.equal(modal.classList.contains("hidden"), false);
  assert.equal(get("swappRequestTitle").textContent, target.title);
  assert.equal(focus(), add);

  add.click();
  app.finishAdd(own);
  assert.equal(get("swappRequestTitle").textContent, target.title);
  assert.equal(get("swappSingleOffer").textContent, own.title);
  assert.deepEqual(checkboxes(), []);
  assert.equal(focus(), send);
  assert.equal(send.textContent, "Send request with this notebook");
  await app.submitSwappRequest();
  assert.deepEqual(sent, [[target.id, [own.id]]]);
});

test("several offers use label rows, validate inline, and submit checked IDs", async () => {
  const { app, get, checkboxes, focus, sent } = loadModal([
    own,
    { ...own, id: 24, title: "Second notebook" },
  ]);
  assert.deepEqual(get("swappRequestChoices").children.map((label) => label.tag), ["label", "label"]);
  assert.equal(get("swappRequestSendBtn").textContent, "Send request");
  await app.submitSwappRequest();
  assert.deepEqual(sent, []);
  assert.match(get("swappRequestError").textContent, /Select at least one notebook/);
  assert.equal(focus(), checkboxes()[0]);
  checkboxes()[1].checked = true;
  checkboxes()[1].change();
  assert.equal(get("swappRequestError").textContent, "");
  await app.submitSwappRequest();
  assert.deepEqual(sent, [[target.id, [24]]]);
});

test("the new offer is checked once if the student's notebook list already contains it", () => {
  const { app, get, checkboxes, focus } = loadModal();
  get("swappAddOfferBtn").click();
  app.state.notebooks.push(own, { ...own, id: 24 });
  app.finishAdd(own);
  assert.deepEqual(checkboxes().map(({ value, checked }) => [value, checked]), [
    ["23", true],
    ["24", false],
  ]);
  assert.equal(focus(), checkboxes()[0]);
});

test("a server NO_NOTEBOOKS response returns to the add offer action in the same request", async () => {
  const { app, get, focus } = loadModal([own]);
  app.sendSwapp = async () => { throw Object.assign(new Error("No notebooks"), { code: "NO_NOTEBOOKS" }); };
  await app.submitSwappRequest();
  assert.equal(get("swappRequestTitle").textContent, target.title);
  assert.equal(get("swappRequestSendBtn").classList.contains("hidden"), true);
  assert.equal(focus(), get("swappAddOfferBtn"));
});
