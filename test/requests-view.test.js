// The Requests page (public/js/app/swapps.js) must tell each student what
// they receive and what they share, from their own side of the swap.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "..", "public", "js", "app", "swapps.js"), "utf8");

function loadApp(me, swapps) {
  const root = { SWAPPR: { state: { currentUser: { username: me }, swapps } } };
  vm.runInNewContext(source, { window: root });
  return root.SWAPPR;
}

const notebook = (id, title) => ({ id, title, status: "active" });

// ana asked bo for "Bo's Calculus", offering "Ana's Physics".
const SWAPPS = [
  {
    id: 1,
    sender: "ana",
    receiver: "bo",
    status: "pending",
    requestedNotebooks: [notebook(10, "Bo's Calculus")],
    offeredNotebooks: [notebook(20, "Ana's Physics")],
  },
  {
    id: 2,
    sender: "bo",
    receiver: "ana",
    status: "accepted",
    chatEnded: false,
    requestedNotebooks: [notebook(21, "Ana's Chemistry")],
    offeredNotebooks: [notebook(11, "Bo's Biology")],
  },
];

// Returns [{ receive: [...titles], share: [...titles] }] for each card in a section.
function exchanges(html, heading) {
  const start = html.indexOf(`>${heading}</h3>`);
  assert.notEqual(start, -1, `section "${heading}" exists`);
  const end = html.indexOf("<section", start);
  const section = html.slice(start, end === -1 ? undefined : end);
  return [...section.matchAll(/You receive<\/p>([\s\S]*?)You share<\/p>([\s\S]*?)<\/div>\s*<\/div>/g)].map(
    ([, receive, share]) => ({
      receive: [...receive.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]),
      share: [...share.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]),
    }),
  );
}

test("the receiver of a request receives the offer and shares the requested notebook", () => {
  const html = loadApp("bo", SWAPPS).renderRequests();
  assert.deepEqual(exchanges(html, "Needs a response"), [
    { receive: ["Ana&#39;s Physics"], share: ["Bo&#39;s Calculus"] },
  ]);
  assert.match(html, /class="respond-btn btn-solid"[^>]*data-status="accepted"/);
});

test("the sender of a request sees it under Your requests from their side", () => {
  const html = loadApp("ana", SWAPPS).renderRequests();
  assert.deepEqual(exchanges(html, "Your requests"), [
    { receive: ["Bo&#39;s Calculus"], share: ["Ana&#39;s Physics"] },
  ]);
  assert.match(html, /Waiting for a response/);
  assert.deepEqual(exchanges(html, "Needs a response"), []);
});

test("an active swap shows each side's notebooks and leads with Open chat", () => {
  for (const [me, expected] of [
    ["ana", { receive: ["Bo&#39;s Biology"], share: ["Ana&#39;s Chemistry"] }],
    ["bo", { receive: ["Ana&#39;s Chemistry"], share: ["Bo&#39;s Biology"] }],
  ]) {
    const html = loadApp(me, SWAPPS).renderRequests();
    assert.deepEqual(exchanges(html, "Active swaps"), [expected], me);
    assert.match(html, /class="open-chat-btn btn-solid"/);
    assert.match(html, /class="open-chat-btn btn-solid"[^>]*data-chat-swapp="2"/);
    assert.match(html, /data-chat-button-badge[^>]*class="chat-count hidden"/);
    assert.match(html, /<details class="more-menu">[\s\S]*Cancel swap/);
  }
});

test("newer declines do not hide an outstanding request", () => {
  const declines = Array.from({ length: 11 }, (_, index) => ({
    ...SWAPPS[0],
    id: index + 3,
    receiver: "other",
    status: "rejected",
  }));
  const html = loadApp("ana", [SWAPPS[0], ...declines]).renderRequests();
  assert.match(html, /Request to @bo/);
  assert.equal(exchanges(html, "Your requests").length, 11);
});

test("usernames and titles are escaped", () => {
  const html = loadApp("bo", [
    { ...SWAPPS[0], sender: "<img src=x>", offeredNotebooks: [notebook(9, "<b>x</b>")] },
  ]).renderRequests();
  assert.doesNotMatch(html, /<img src=x>|<b>x<\/b>/);
  assert.match(html, /@&lt;img src=x&gt; wants to swap/);
});

test("empty sections say what will appear there", () => {
  const html = loadApp("cy", SWAPPS).renderRequests();
  assert.match(html, /No requests are waiting for you\./);
  assert.match(html, /No active swaps\. Accepted requests appear here\./);
  assert.match(html, /You haven't sent any requests yet\./);
});
