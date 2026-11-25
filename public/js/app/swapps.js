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

  // ── Swaps page (IDX005, FUNC-011) ───────────────────────────────────────
  // Every card shows what the student receives and shares. Pending actions
  // stay in place while saving, and failures keep the option to retry.

  const busy = new Map(); // swapp id -> "accepting" | "declining" | "cancelling"
  const failures = new Map(); // swapp id -> message

  const BUSY_LABELS = {
    accepting: "Accepting…",
    declining: "Declining…",
    cancelling: "Cancelling…",
  };

  const BUSY_FOCUS = {
    accepting: "accepted",
    declining: "rejected",
    cancelling: "more",
  };

  function progressFocus(state) {
    return state ? `tabindex="-1" data-request-focus="${BUSY_FOCUS[state]}"` : "";
  }

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

  // FUNC-011 REQT-002: requester, trust score, exchange, Accept and Decline.
  function requestCard(swapp) {
    const id = escapeHtml(swapp.id);
    const state = busy.get(String(swapp.id));
    const disabled = state ? "disabled" : "";
    return `
      <article class="request-card" data-swapp="${id}">
        <div class="request-card-head">
          <div class="min-w-0">
            <p class="request-title">@${escapeHtml(swapp.sender)} wants to swap</p>
            <p class="request-meta">Trust score ${escapeHtml(swapp.senderTrustScore ?? 100)}%</p>
            ${sentLabel(swapp)}
          </div>
          <span class="status-pill status-pending" ${progressFocus(state)}>${state ? BUSY_LABELS[state] : "Pending"}</span>
        </div>
        ${exchange(swapp.offeredNotebooks, swapp.requestedNotebooks)}
        ${failureLine(swapp)}
        <div class="request-actions">
          <button type="button" class="respond-btn btn-solid" data-id="${id}" data-status="accepted" data-request-focus="accepted" ${disabled}>
            ${state === "accepting" ? BUSY_LABELS.accepting : "Accept"}
          </button>
          <button type="button" class="respond-btn btn-outline" data-id="${id}" data-status="rejected" data-request-focus="rejected" ${disabled}>
            ${state === "declining" ? BUSY_LABELS.declining : "Decline"}
          </button>
        </div>
      </article>
    `;
  }

  function swapSides(swapp, me) {
    return swapp.sender === me
      ? { partner: swapp.receiver, receive: swapp.requestedNotebooks, share: swapp.offeredNotebooks }
      : { partner: swapp.sender, receive: swapp.offeredNotebooks, share: swapp.requestedNotebooks };
  }

  function notebookActions(notebooks = [], disabled = false) {
    const available = notebooks.filter((notebook) => !HIDDEN_NOTE[notebook.status]);
    return available.map((notebook) => {
      const id = escapeHtml(notebook.id);
      const title = escapeHtml(notebook.title);
      return `<button type="button" class="btn-outline swap-notebook-btn" data-notebook-id="${id}"
        data-request-focus="notebook-${id}" aria-label="Open notebook: ${title}" ${disabled ? "disabled" : ""}>
        <i data-lucide="external-link" class="w-4 h-4 shrink-0"></i>
        ${available.length > 1 ? `Open notebook: ${title}` : "Open notebook"}
      </button>`;
    }).join("");
  }

  // Lead with Open chat, with Cancel tucked behind More.
  function activeSwappCard(swapp, me) {
    const { partner, receive, share } = swapSides(swapp, me);
    const id = escapeHtml(swapp.id);
    const state = busy.get(String(swapp.id));
    const unread = app.getChatUnreadForSwapp?.(swapp.id) || 0;
    return `
      <article class="request-card" data-swapp="${id}">
        <div class="request-card-head">
          <p class="request-title min-w-0">Swap with @${escapeHtml(partner)}</p>
          <span class="status-pill status-active" ${progressFocus(state)}>${state ? BUSY_LABELS[state] : "Active"}</span>
        </div>
        ${exchange(receive, share)}
        ${failureLine(swapp)}
        <div class="request-actions">
          <button type="button" class="open-chat-btn btn-solid" data-id="${id}" data-chat-swapp="${id}" data-request-focus="chat" ${state ? "disabled" : ""}>
            <i data-lucide="message-circle" class="w-4 h-4"></i>
            Open chat
            <span data-chat-button-badge aria-label="${unread} unread" class="chat-count${unread ? "" : " hidden"}">${unread > 9 ? "9+" : unread}</span>
          </button>
          ${notebookActions(receive, Boolean(state))}
          <details class="more-menu">
            <summary aria-label="More actions for this swap" data-request-focus="more">More</summary>
            <div class="more-menu-list">
              <button
                type="button"
                class="cancel-swapp-btn"
                data-request-focus="more"
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

  function sentRequestCard(swapp) {
    return `
      <article class="request-card">
        <div class="request-card-head">
          <div class="min-w-0">
            <p class="request-title">Request to @${escapeHtml(swapp.receiver)}</p>
            ${sentLabel(swapp)}
          </div>
          <span class="status-pill status-pending">Waiting for a response</span>
        </div>
        ${exchange(swapp.requestedNotebooks, swapp.offeredNotebooks)}
      </article>
    `;
  }

  const PAST_STATUS = { rejected: "Declined", cancelled: "Cancelled", accepted: "Ended" };

  function pastSwapCard(swapp, me) {
    const { partner, receive, share } = swapSides(swapp, me);
    // An ended chat leaves the swap accepted and its notebook files unlocked.
    const actions = swapp.status === "accepted" ? notebookActions(receive) : "";
    const relationship = swapp.status === "rejected"
      ? (swapp.sender === me ? "Request to" : "Request from")
      : "Swap with";
    return `
      <article class="request-card" data-swapp="${escapeHtml(swapp.id)}">
        <div class="request-card-head">
          <div class="min-w-0">
            <p class="request-title">${relationship} @${escapeHtml(partner)}</p>
            ${sentLabel(swapp)}
          </div>
          <span class="status-pill status-ended">${PAST_STATUS[swapp.status]}</span>
        </div>
        ${exchange(receive, share)}
        ${actions ? `<div class="request-actions">${actions}</div>` : ""}
      </article>
    `;
  }

  function section({ title, cards, emptyText }) {
    return `
      <section class="requests-section${cards.length ? "" : " swaps-empty-section"}">
        <h3 class="requests-heading">${title} (${cards.length})</h3>
        ${cards.length ? cards.join("") : `<p class="requests-empty">${emptyText}</p>`}
      </section>`;
  }

  function pastSection(swapps, me) {
    if (!swapps.length) return "";
    return `
      <details class="swaps-history">
        <summary><h3 class="requests-heading">Past swaps (${swapps.length})</h3></summary>
        <div class="requests-section">
          ${swapps.map((swapp) => pastSwapCard(swapp, me)).join("")}
        </div>
      </details>`;
  }

  app.renderRequests = function renderRequests() {
    const currentUser = app.state.currentUser;
    if (!currentUser) {
      return `<p class="requests-empty">Please sign in.</p>`;
    }
    const me = currentUser.username;
    const swaps = mySwapps();
    const incoming = swaps.filter((swapp) => swapp.receiver === me && swapp.status === "pending");
    const active = swaps.filter(isOpen);
    const sent = swaps
      .filter((swapp) => swapp.sender === me && swapp.status === "pending")
      .sort((a, b) => b.id - a.id);
    const past = swaps.filter((swapp) => Object.hasOwn(PAST_STATUS, swapp.status) && !isOpen(swapp));

    const sections = [
      {
        title: "Needs your reply",
        cards: incoming.map(requestCard),
        emptyText: "No replies needed.",
      },
      {
        title: "Active",
        cards: active.map((swapp) => activeSwappCard(swapp, me)),
        emptyText: "Accepted requests appear here.",
      },
      { title: "Sent", cards: sent.map(sentRequestCard), emptyText: "Nothing sent yet." },
    ];

    const filled = sections.filter(({ cards }) => cards.length).map(section).join("");
    const empty = sections.filter(({ cards }) => !cards.length).map(section).join("");
    return filled + pastSection(past, me) + (empty ? `<div class="swaps-empty-list">${empty}</div>` : "");
  };

  app.renderRequestsView = function renderRequestsView(grid) {
    const previousAction = document.activeElement.closest("[data-request-focus]");
    const previousCard = previousAction?.closest("[data-swapp]");
    const restoreFocus = previousCard && grid.contains(previousCard);

    const previousHistory = grid.querySelector(".swaps-history");
    const historyWasFocused = previousHistory?.firstElementChild === document.activeElement;
    grid.innerHTML = app.renderRequests();
    const history = grid.querySelector(".swaps-history");
    if (history) {
      history.open = previousHistory?.open || false;
      if (historyWasFocused) history.firstElementChild.focus();
    }

    grid.querySelectorAll(".respond-btn").forEach((button) => {
      button.addEventListener("click", () => {
        app.respondSwapp(button.dataset.id, button.dataset.status);
      });
    });

    grid.querySelectorAll(".open-chat-btn").forEach((button) => {
      button.addEventListener("click", () => app.openChatForSwapp?.(Number(button.dataset.id)));
    });

    grid.querySelectorAll(".swap-notebook-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const id = Number(button.dataset.notebookId);
        const notebook = app.state.notebooks.find((item) => item.id === id);
        app.openNotebookFile(notebook);
      });
    });

    grid.querySelectorAll(".cancel-swapp-btn").forEach((button) => {
      button.addEventListener("click", () => {
        app.cancelSwapp(button.dataset.id, button.dataset.partner);
      });
    });

    if (restoreFocus) {
      const card = [...grid.querySelectorAll("[data-swapp]")].find(
        (item) => item.dataset.swapp === previousCard.dataset.swapp,
      );
      const action = previousAction.dataset.requestFocus;
      const target = card?.querySelector(`[data-request-focus="${action}"]:not(:disabled)`)
        || card?.querySelector(".open-chat-btn:not(:disabled)")
        || document.getElementById("sectionTitle");
      target?.focus();
    }

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
      message = `@${names[0]} and ${names.length - 1} more cancelled swaps with you.`;
    } else if (notices.length > 1) {
      message = `@${names[0]} cancelled ${notices.length} swaps with you.`;
    } else {
      message = `@${names[0]} cancelled a swap with you.`;
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

  app.startSwappUpdates = function startSwappUpdates({ immediate = true } = {}) {
    if (swappTimer) clearInterval(swappTimer);
    if (immediate) app.checkSwappUpdates();
    swappTimer = setInterval(app.checkSwappUpdates, SWAPP_CHECK_INTERVAL_MS);
  };

  app.updateRequestBadge = function updateRequestBadge() {
    const currentUser = app.state.currentUser;
    const badges = document.querySelectorAll("[data-requests-badge]");
    if (!badges.length || !currentUser) return;

    const count = app.state.swapps.filter(
      (swapp) => swapp.receiver === currentUser.username && swapp.status === "pending",
    ).length;

    badges.forEach((badge) => {
      badge.textContent = String(count);
      const label = `${count} pending swap request${count === 1 ? "" : "s"}`;
      badge.setAttribute("aria-label", label);
      badge.title = label;
      badge.classList.toggle("hidden", count === 0);
    });
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
