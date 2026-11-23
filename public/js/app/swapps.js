(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // Usernames aren't restricted at registration, so they're escaped before
  // going into the card markup.
  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (ch) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
    );
  }

  // ── SWAPP state per notebook (Transaction_Manifest) ─────────────────────
  // Each SWAPP from the server carries requestedNotebooks (the receiver's)
  // and offeredNotebooks (the sender's): its manifest lines.

  function manifestIds(swapp) {
    return [...(swapp.requestedNotebooks || []), ...(swapp.offeredNotebooks || [])].map(
      (notebook) => notebook.id,
    );
  }

  function newest(swapps) {
    return swapps.reduce((latest, swapp) => (!latest || swapp.id > latest.id ? swapp : latest), null);
  }

  function mySwapps() {
    const me = app.state.currentUser?.username;
    return app.state.swapps.filter((swapp) => swapp.sender === me || swapp.receiver === me);
  }

  // FUNC-011 REQT-006: a notebook is unlocked by an accepted SWAPP whose
  // manifest lists it.
  app.unlockedNotebookIds = function unlockedNotebookIds() {
    return new Set(
      mySwapps()
        .filter((swapp) => swapp.status === "accepted")
        .flatMap(manifestIds),
    );
  };

  // What a notebook card should show for the current student:
  // accessSwapp — the accepted SWAPP that unlocked it (null if locked);
  // pending — they already asked for it and are waiting;
  // cancelled — the latest SWAPP it was part of was cancelled (FUNC-011
  //   REQT-009, shown to both students);
  // declined — their most recent request for it was rejected.
  app.swappStateFor = function swappStateFor(notebook) {
    const me = app.state.currentUser?.username;
    const withNotebook = mySwapps().filter((swapp) => manifestIds(swapp).includes(notebook.id));

    const accessSwapp = newest(withNotebook.filter((swapp) => swapp.status === "accepted"));
    const myRequests = withNotebook.filter(
      (swapp) =>
        swapp.sender === me &&
        (swapp.requestedNotebooks || []).some((requested) => requested.id === notebook.id),
    );
    const cancelled = newest(withNotebook)?.status === "cancelled";
    return {
      accessSwapp,
      pending: myRequests.some((swapp) => swapp.status === "pending"),
      cancelled,
      declined: !cancelled && newest(myRequests)?.status === "rejected",
    };
  };

  // An accepted SWAPP stays open until its chat is ended; only open SWAPPs
  // can be cancelled.
  function isOpen(swapp) {
    return swapp.status === "accepted" && !swapp.chatEnded;
  }

  // ── Requests page (IDX005, FUNC-011) ────────────────────────────────────
  // Three sections: requests waiting on this student, their active swaps,
  // and requests they sent. Every card says what the student receives and
  // what they share. A card being answered or cancelled shows that state
  // until the server replies; a failed action keeps its card with a retry.

  const busy = new Map(); // swapp id -> "accepting" | "declining" | "cancelling"
  const failures = new Map(); // swapp id -> message

  const BUSY_LABELS = {
    accepting: "Accepting…",
    declining: "Declining…",
    cancelling: "Cancelling…",
  };

  function rerenderRequests() {
    if (app.state.currentFilter === "requests") app.renderNotebooks?.();
  }

  function sentLabel(swapp) {
    // IDX005: Sent Sep 29, 2026, 10:14 AM
    const sent = root.SWAPPRDates?.formatLongDateTime(swapp.date_created);
    return sent ? `<p class="request-meta">Sent ${escapeHtml(sent)}</p>` : "";
  }

  const HIDDEN_NOTE = { under_review: "under review", removed: "removed" };

  function notebookList(notebooks) {
    if (!notebooks.length) {
      return `<p class="request-meta">No notebooks listed.</p>`;
    }
    return `<ul class="request-notebooks">${notebooks
      .map(
        (notebook) => `
          <li>
            <i data-lucide="book-open" class="w-3.5 h-3.5 shrink-0"></i>
            <span>${escapeHtml(notebook.title)}</span>
            ${
              HIDDEN_NOTE[notebook.status]
                ? `<span class="request-hidden-note">(${HIDDEN_NOTE[notebook.status]})</span>`
                : ""
            }
          </li>`,
      )
      .join("")}</ul>`;
  }

  function exchange(youReceive, youShare) {
    return `
      <div class="exchange-grid">
        <div>
          <p class="exchange-label">You receive</p>
          ${notebookList(youReceive || [])}
        </div>
        <div>
          <p class="exchange-label">You share</p>
          ${notebookList(youShare || [])}
        </div>
      </div>`;
  }

  function failureLine(swapp) {
    const message = failures.get(String(swapp.id));
    return message ? `<p class="request-error" role="alert">${escapeHtml(message)}</p>` : "";
  }

  // FUNC-011 REQT-002: requester username, "Pending your approval", the
  // requester's trust score, the notebooks they offer, Accept and Decline.
  function requestCard(swapp) {
    const id = escapeHtml(swapp.id);
    const state = busy.get(String(swapp.id));
    const disabled = state ? "disabled" : "";
    return `
      <article class="request-card" data-swapp="${id}">
        <div class="request-card-head">
          <div class="min-w-0">
            <p class="request-title">@${escapeHtml(swapp.sender)} wants to swap</p>
            <p class="request-meta request-meta-row">
              <span>Pending your approval</span>
              <span>Trust score ${escapeHtml(swapp.senderTrustScore ?? 100)}%</span>
            </p>
            ${sentLabel(swapp)}
          </div>
          <span class="status-pill status-pending">${state ? escapeHtml(BUSY_LABELS[state]) : "Pending"}</span>
        </div>
        ${exchange(swapp.offeredNotebooks, swapp.requestedNotebooks)}
        ${failureLine(swapp)}
        <div class="request-actions">
          <button type="button" class="respond-btn btn-solid" data-id="${id}" data-status="accepted" ${disabled}>
            ${state === "accepting" ? BUSY_LABELS.accepting : "Accept"}
          </button>
          <button type="button" class="respond-btn btn-outline" data-id="${id}" data-status="rejected" ${disabled}>
            ${state === "declining" ? BUSY_LABELS.declining : "Decline"}
          </button>
        </div>
      </article>
    `;
  }

  // One open SWAPP: what each side gets, Open chat first, Cancel tucked away.
  function activeSwappCard(swapp, me) {
    const iSentIt = swapp.sender === me;
    const partner = iSentIt ? swapp.receiver : swapp.sender;
    const youReceive = iSentIt ? swapp.requestedNotebooks : swapp.offeredNotebooks;
    const youShare = iSentIt ? swapp.offeredNotebooks : swapp.requestedNotebooks;
    const id = escapeHtml(swapp.id);
    const state = busy.get(String(swapp.id));
    const unread = app.getChatUnreadForSwapp?.(swapp.id) || 0;
    return `
      <article class="request-card" data-swapp="${id}">
        <div class="request-card-head">
          <p class="request-title min-w-0">Swap with @${escapeHtml(partner)}</p>
          <span class="status-pill status-active">${state ? escapeHtml(BUSY_LABELS[state]) : "Active"}</span>
        </div>
        ${exchange(youReceive, youShare)}
        ${failureLine(swapp)}
        <div class="request-actions">
          <button type="button" class="open-chat-btn btn-solid" data-id="${id}" ${state ? "disabled" : ""}>
            <i data-lucide="message-circle" class="w-4 h-4"></i>
            Open chat
            ${unread ? `<span class="chat-count" aria-label="${unread} unread">${unread > 9 ? "9+" : unread}</span>` : ""}
          </button>
          <details class="more-menu">
            <summary aria-label="More actions for this swap">More</summary>
            <div class="more-menu-list">
              <button
                type="button"
                class="cancel-swapp-btn"
                data-id="${id}"
                data-partner="${escapeHtml(partner)}"
                ${state ? "disabled" : ""}
              >
                Cancel swap
              </button>
            </div>
          </details>
        </div>
      </article>
    `;
  }

  const SENT_STATUS = {
    pending: { label: "Waiting for a response", tone: "status-pending" },
    rejected: { label: "Declined", tone: "status-ended" },
  };

  // A request this student sent that hasn't become an active swap.
  function sentRequestCard(swapp) {
    const status = SENT_STATUS[swapp.status];
    return `
      <article class="request-card">
        <div class="request-card-head">
          <div class="min-w-0">
            <p class="request-title">Request to @${escapeHtml(swapp.receiver)}</p>
            ${sentLabel(swapp)}
          </div>
          <span class="status-pill ${status.tone}">${status.label}</span>
        </div>
        ${exchange(swapp.requestedNotebooks, swapp.offeredNotebooks)}
      </article>
    `;
  }

  const SENT_LIMIT = 10;

  function section(title, cards, emptyText) {
    return `
      <section class="requests-section">
        <h3 class="requests-heading">${title}</h3>
        ${cards.length ? cards.join("") : `<p class="requests-empty">${emptyText}</p>`}
      </section>`;
  }

  app.renderRequests = function renderRequests() {
    const currentUser = app.state.currentUser;
    if (!currentUser) {
      return `<p class="requests-empty">Please sign in.</p>`;
    }
    const me = currentUser.username;

    const incoming = app.state.swapps.filter(
      (swapp) => swapp.receiver === me && swapp.status === "pending",
    );
    const active = mySwapps().filter(isOpen);
    const sent = app.state.swapps
      .filter((swapp) => swapp.sender === me && SENT_STATUS[swapp.status])
      .sort((a, b) => b.id - a.id)
      .slice(0, SENT_LIMIT);

    return [
      section("Needs a response", incoming.map(requestCard), "No requests are waiting for you."),
      section(
        "Active swaps",
        active.map((swapp) => activeSwappCard(swapp, me)),
        "No active swaps. Accepted requests appear here.",
      ),
      section("Your requests", sent.map(sentRequestCard), "You haven't sent any requests yet."),
    ].join("");
  };

  app.attachRequestListeners = function attachRequestListeners() {
    document.querySelectorAll(".respond-btn").forEach((button) => {
      button.addEventListener("click", () => {
        app.respondSwapp(button.dataset.id, button.dataset.status);
      });
    });

    document.querySelectorAll(".open-chat-btn").forEach((button) => {
      button.addEventListener("click", () => app.openChatForSwapp?.(Number(button.dataset.id)));
    });

    document.querySelectorAll(".cancel-swapp-btn").forEach((button) => {
      button.addEventListener("click", () => {
        button.closest("details")?.removeAttribute("open");
        app.cancelSwapp(button.dataset.id, button.dataset.partner);
      });
    });

    root.lucide?.createIcons();
  };

  // FUNC-011 REQT-009, REQT-010: cancelling voids the SWAPP, both students
  // lose access to its notebooks, and its chat closes.
  app.cancelSwapp = async function cancelSwapp(id, partner) {
    const question =
      `Cancel your swap with @${partner}?\n\n` +
      "You will both lose access to its notebooks and its chat will close.";
    if (!confirm(question)) return;

    const key = String(id);
    if (busy.has(key)) return;
    busy.set(key, "cancelling");
    failures.delete(key);
    rerenderRequests();
    try {
      await app.api.cancelSwapp(id);
      app.showToast("Swap cancelled.");
    } catch (err) {
      failures.set(key, `${err.message || "Couldn't cancel the swap."} Try again.`);
      console.error(err);
    } finally {
      busy.delete(key);
    }
    await app.loadSwapps();
    // Reload the feed so file links the student can no longer open are gone.
    await app.loadNotebooks?.();
    rerenderRequests();
    app.refreshChatNotifications?.();
  };

  // Changes when any SWAPP is created, answered, cancelled or ended.
  function signature(swapps) {
    return swapps.map((swapp) => `${swapp.id}:${swapp.status}:${swapp.chatEnded ? 1 : 0}`).join("|");
  }
  let swappsSignature = "";
  let swappsLoaded = false;

  function storeSwapps(swapps) {
    app.state.swapps = swapps;
    swappsSignature = signature(swapps);
    swappsLoaded = true;
    app.updateRequestBadge();
  }

  app.loadSwapps = async function loadSwapps() {
    const currentUser = app.state.currentUser;
    if (!currentUser) return;

    try {
      const data = await app.api.getSwapps(currentUser.username);
      storeSwapps(data.swapps || []);
    } catch {}
  };

  // FUNC-011 REQT-009: tell a student that the other side cancelled a SWAPP.
  // Each notice is shown once, then marked seen on the server.
  async function showCancelNotices(swapps) {
    const me = app.state.currentUser?.username;
    const notices = swapps.filter(
      (swapp) =>
        swapp.status === "cancelled" &&
        swapp.cancelledBy &&
        swapp.cancelledBy !== me &&
        !swapp.cancel_notified,
    );
    if (!notices.length) return;

    const names = [...new Set(notices.map((swapp) => swapp.cancelledBy))];
    let message;
    if (names.length > 1) {
      message = `@${names[0]} and ${names.length - 1} more cancelled SWAPPs with you.`;
    } else if (notices.length > 1) {
      message = `@${names[0]} cancelled ${notices.length} SWAPPs with you.`;
    } else {
      message = `@${names[0]} cancelled a SWAPP with you.`;
    }
    app.showToast(message);

    notices.forEach((swapp) => {
      swapp.cancel_notified = 1;
    });
    await Promise.all(
      notices.map((swapp) => app.api.markCancelSeen(swapp.id).catch(() => {})),
    );
  }

  // Checks every few seconds for SWAPP changes made by the other student
  // (a request accepted, a SWAPP cancelled). When something changed, the feed
  // reloads so access and file links match, and cancel notices are shown.
  app.checkSwappUpdates = async function checkSwappUpdates() {
    const currentUser = app.state.currentUser;
    if (!currentUser) return;

    let swapps;
    try {
      swapps = (await app.api.getSwapps(currentUser.username)).swapps || [];
    } catch {
      return;
    }
    const changed = swappsLoaded && signature(swapps) !== swappsSignature;
    storeSwapps(swapps);
    // The page's own data refresh: the feed on index.html, the profile on
    // profile.html.
    if (changed) await (app.reloadAfterSwappChange || app.loadNotebooks)?.();
    await showCancelNotices(swapps);
  };

  const SWAPP_CHECK_INTERVAL_MS = 5000;
  let swappTimer = null;

  app.startSwappUpdates = function startSwappUpdates() {
    if (swappTimer) clearInterval(swappTimer);
    app.checkSwappUpdates();
    swappTimer = setInterval(app.checkSwappUpdates, SWAPP_CHECK_INTERVAL_MS);
  };

  app.updateRequestBadge = function updateRequestBadge() {
    const currentUser = app.state.currentUser;
    const badges = document.querySelectorAll("[data-requests-badge]");
    if (!badges.length || !currentUser) return;

    const count = app.state.swapps.filter(
      (swapp) => swapp.receiver === currentUser.username && swapp.status === "pending",
    ).length;

    if (count > 0) {
      badges.forEach((badge) => {
        badge.textContent = count;
        badge.classList.remove("hidden");
      });
    } else {
      badges.forEach((badge) => badge.classList.add("hidden"));
    }
  };

  // FUNC-010: request one notebook, offering one or more of your own. The
  // server takes the sender from the session and the receiver from the
  // requested notebook's author.
  app.sendSwapp = async function sendSwapp(notebookId, offeredNotebookIds) {
    return app.api.sendSwapp({ notebookId, offeredNotebookIds });
  };

  app.respondSwapp = async function respondSwapp(id, status) {
    const key = String(id);
    if (busy.has(key)) return;
    busy.set(key, status === "accepted" ? "accepting" : "declining");
    failures.delete(key);
    rerenderRequests();
    try {
      await app.api.respondSwapp(id, { status });
      app.showToast(
        status === "accepted"
          ? "Swap accepted. Open chat to start talking."
          : "Request declined.",
      );
    } catch (err) {
      failures.set(key, `${err.message || "Couldn't send your answer."} Try again.`);
      console.error(err);
    } finally {
      busy.delete(key);
    }
    // Either way, show the request's real state (e.g. already answered).
    // Reloading the feed also brings the file links an accepted SWAPP unlocks.
    await app.loadSwapps();
    await app.loadNotebooks?.();
    rerenderRequests();
  };
})(window);
