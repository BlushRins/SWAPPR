// The Swaps page (public/js/app/swapps.js) must tell each student what
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
  const end = html.indexOf("</section>", start);
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
  assert.deepEqual(exchanges(html, "Needs your reply (1)"), [
    { receive: ["Ana&#39;s Physics"], share: ["Bo&#39;s Calculus"] },
  ]);
  assert.match(html, /class="respond-btn btn-solid"[^>]*data-status="accepted"/);
  assert.match(html, /class="respond-btn btn-outline"[^>]*data-status="rejected"/);
  const card = html.match(/<article class="request-card" data-swapp="1">[\s\S]*?<\/article>/)[0];
  assert.equal((card.match(/class="status-pill/g) || []).length, 1);
  assert.doesNotMatch(card, /Pending your approval/);
});

test("the sender of a request sees it under Sent from their side", () => {
  const html = loadApp("ana", SWAPPS).renderRequests();
  assert.deepEqual(exchanges(html, "Sent (1)"), [
    { receive: ["Bo&#39;s Calculus"], share: ["Ana&#39;s Physics"] },
  ]);
  assert.match(html, /Waiting for a response/);
  assert.deepEqual(exchanges(html, "Needs your reply (0)"), []);
});

test("an active swap shows each side's notebooks and leads with Open chat", () => {
  for (const [me, expected] of [
    ["ana", { receive: ["Bo&#39;s Biology"], share: ["Ana&#39;s Chemistry"] }],
    ["bo", { receive: ["Ana&#39;s Chemistry"], share: ["Bo&#39;s Biology"] }],
  ]) {
    const html = loadApp(me, SWAPPS).renderRequests();
    assert.deepEqual(exchanges(html, "Active (1)"), [expected], me);
    assert.match(html, /class="open-chat-btn btn-solid"/);
    assert.match(html, /class="open-chat-btn btn-solid"[^>]*data-chat-swapp="2"/);
    assert.match(html, /data-chat-button-badge[^>]*class="chat-count hidden"/);
    assert.match(html, /<details class="more-menu">[\s\S]*Cancel swap/);
    const receiveId = me === "ana" ? 11 : 21;
    const shareId = me === "ana" ? 21 : 11;
    assert.match(html, new RegExp(`class="open-chat-btn[\\s\\S]*class="btn-outline swap-notebook-btn" data-notebook-id="${receiveId}"`));
    assert.doesNotMatch(html, new RegExp(`data-notebook-id="${shareId}"`));
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
  assert.equal(exchanges(html, "Sent (1)").length, 1);
  assert.match(html, /<details class="swaps-history">\s*<summary><h3 class="requests-heading">Past swaps \(11\)<\/h3>/);
  const history = html.match(/<details class="swaps-history">[\s\S]*?<\/details>/)[0];
  assert.equal((history.match(/status-ended">Declined/g) || []).length, 11);
  assert.ok(html.indexOf("Sent (1)") < html.indexOf("Past swaps (11)"));
  assert.ok(html.indexOf("Past swaps (11)") < html.indexOf("Needs your reply (0)"));
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
  assert.match(html, /No replies needed\./);
  assert.match(html, /Accepted requests appear here\./);
  assert.match(html, /Nothing sent yet\./);
});

function headings(html) {
  return [...html.matchAll(/<h3 class="requests-heading">([^<]+)<\/h3>/g)].map((match) => match[1]);
}

test("filled sections follow reply, active, sent order with exact counts", () => {
  const incoming = { ...SWAPPS[0], id: 3, sender: "cy", receiver: "ana" };
  const twoSent = { ...SWAPPS[0], id: 4, receiver: "cy" };
  const html = loadApp("ana", [...SWAPPS, twoSent, incoming]).renderRequests();
  assert.deepEqual(headings(html), ["Needs your reply (1)", "Active (1)", "Sent (2)"]);
  assert.doesNotMatch(html, /swaps-empty-section|swaps-history/);
});

test("empty sections follow filled sections and have a single message each", () => {
  const html = loadApp("ana", [SWAPPS[0]]).renderRequests();
  assert.deepEqual(headings(html), ["Sent (1)", "Needs your reply (0)", "Active (0)"]);
  assert.equal((html.match(/class="requests-empty"/g) || []).length, 2);
});

test("ended swaps retain notebook access in history and cancelled swaps lose it", () => {
  const ended = { ...SWAPPS[1], chatEnded: true };
  const cancelled = {
    ...SWAPPS[1],
    id: 3,
    status: "cancelled",
    offeredNotebooks: [notebook(12, "Bo's Math")],
  };
  const html = loadApp("ana", [ended, cancelled]).renderRequests();
  assert.deepEqual(headings(html), ["Past swaps (2)", "Needs your reply (0)", "Active (0)", "Sent (0)"]);
  assert.match(html, /status-ended">Ended/);
  assert.match(html, /status-ended">Cancelled/);
  assert.match(html, /data-notebook-id="11"/);
  assert.doesNotMatch(html, /data-notebook-id="12"|open-chat-btn/);
});

test("each available received notebook is reachable and hidden notebooks have no action", () => {
  const multi = {
    ...SWAPPS[1],
    offeredNotebooks: [
      ...SWAPPS[1].offeredNotebooks,
      notebook(12, "Bo's Math"),
      { ...notebook(13, "Bo's Astronomy"), status: "under_review" },
    ],
  };
  const html = loadApp("ana", [multi]).renderRequests();
  assert.match(html, /data-notebook-id="11"/);
  assert.match(html, /data-notebook-id="12"/);
  assert.doesNotMatch(html, /data-notebook-id="13"/);
});
