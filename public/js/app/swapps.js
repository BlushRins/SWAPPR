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

  function sentLabel(swapp) {
    const sent = root.SWAPPRDates?.formatDateTime(swapp.date_created);
    return sent
      ? `<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Sent ${escapeHtml(sent)}</p>`
      : "";
  }

  const HIDDEN_NOTE = { under_review: "under review", removed: "removed" };

  function notebookList(notebooks) {
    if (!notebooks.length) {
      return `<p class="text-xs text-gray-500 dark:text-gray-400">No notebooks listed.</p>`;
    }
    return `<ul class="request-notebooks">${notebooks
      .map(
        (notebook) => `
          <li>
            <i data-lucide="book-open" class="w-3.5 h-3.5 shrink-0"></i>
            <span>${escapeHtml(notebook.title)}</span>
            ${
              HIDDEN_NOTE[notebook.status]
                ? `<span class="text-xs text-red-500 dark:text-red-400">(${HIDDEN_NOTE[notebook.status]})</span>`
                : ""
            }
          </li>`,
      )
      .join("")}</ul>`;
  }

  // FUNC-011 REQT-002: requester username + "wants to swap", "Pending your
  // approval", "Pending" badge, requester's trust score, the notebooks they
  // offer, Accept and Deny. The notebook they want from you is shown too.
  function requestCard(swapp) {
    return `
      <div class="p-5 rounded-xl bg-white dark:bg-[#181428] shadow border border-purple-100 dark:border-white/[0.06] mb-4">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="min-w-0">
            <p class="text-sm font-bold text-purple-900 dark:text-purple-100 break-words">@${escapeHtml(swapp.sender)} wants to swap</p>
            <p class="text-xs text-purple-400 mt-1">Pending your approval</p>
            ${sentLabel(swapp)}
          </div>
          <span class="text-xs px-2 py-1 rounded-full bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 font-medium shrink-0">Pending</span>
        </div>
        <p class="text-xs font-semibold text-green-600 dark:text-green-400 flex items-center gap-1">
          <i data-lucide="shield-check" class="w-3.5 h-3.5"></i>
          Trust score: ${escapeHtml(swapp.senderTrustScore ?? 100)}%
        </p>
        <div class="mt-3">
          <p class="request-notebooks-label">Notebooks offered</p>
          ${notebookList(swapp.offeredNotebooks || [])}
        </div>
        <div class="mt-3">
          <p class="request-notebooks-label">Your notebook they want</p>
          ${notebookList(swapp.requestedNotebooks || [])}
        </div>
        <div class="flex gap-2 mt-4">
          <button class="respond-btn flex-1 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition disabled:opacity-60" data-id="${escapeHtml(swapp.id)}" data-status="accepted">
            Accept
          </button>
          <button class="respond-btn flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold transition disabled:opacity-60" data-id="${escapeHtml(swapp.id)}" data-status="rejected">
            Deny
          </button>
        </div>
      </div>
    `;
  }

  // One open SWAPP in the Active SWAPPs list, with what each student gets.
  function activeSwappCard(swapp, me) {
    const iSentIt = swapp.sender === me;
    const partner = iSentIt ? swapp.receiver : swapp.sender;
    const youReceive = iSentIt ? swapp.requestedNotebooks : swapp.offeredNotebooks;
    const youGive = iSentIt ? swapp.offeredNotebooks : swapp.requestedNotebooks;
    return `
      <div class="p-5 rounded-xl bg-white dark:bg-[#181428] shadow border border-purple-100 dark:border-white/[0.06] mb-4">
        <div class="flex items-start justify-between gap-3 mb-3">
          <p class="text-sm font-bold text-purple-900 dark:text-purple-100 break-words min-w-0">SWAPP with @${escapeHtml(partner)}</p>
          <span class="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 font-medium shrink-0">Active</span>
        </div>
        <div>
          <p class="request-notebooks-label">You receive</p>
          ${notebookList(youReceive || [])}
        </div>
        <div class="mt-3">
          <p class="request-notebooks-label">You give</p>
          ${notebookList(youGive || [])}
        </div>
        <button
          class="cancel-swapp-btn w-full mt-4 px-4 py-2 rounded-lg border-2 border-red-200 dark:border-red-400/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 font-semibold transition disabled:opacity-60"
          data-id="${escapeHtml(swapp.id)}"
          data-partner="${escapeHtml(partner)}"
        >
          Cancel SWAPP
        </button>
      </div>
    `;
  }

  // Requests page (IDX005): incoming pending requests, newest first
  // (FUNC-011 REQT-003), then the student's open SWAPPs, which can be
  // cancelled here (REQT-009).
  app.renderRequests = function renderRequests() {
    const currentUser = app.state.currentUser;
    if (!currentUser) {
      return `<p class="text-sm text-purple-400">Please log in.</p>`;
    }
    const me = currentUser.username;

    const incoming = app.state.swapps.filter(
      (swapp) => swapp.receiver === me && swapp.status === "pending",
    );
    const active = mySwapps().filter(isOpen);

    const pendingSection = incoming.length
      ? incoming.map(requestCard).join("")
      : `<p class="requests-full text-sm text-purple-400 text-center py-8">No pending requests.</p>`;
    const activeSection = active.length
      ? active.map((swapp) => activeSwappCard(swapp, me)).join("")
      : `<p class="requests-full text-sm text-purple-400 text-center py-8">No active SWAPPs.</p>`;

    return `
      <h3 class="requests-heading">Pending requests</h3>
      ${pendingSection}
      <h3 class="requests-heading">Active SWAPPs</h3>
      ${activeSection}
    `;
  };

  app.attachRequestListeners = function attachRequestListeners() {
    document.querySelectorAll(".respond-btn").forEach((button) => {
      button.addEventListener("click", () => {
        // Both buttons on the card lock so a request is answered only once.
        button
          .closest(".p-5")
          ?.querySelectorAll(".respond-btn")
          .forEach((cardButton) => {
            cardButton.disabled = true;
          });
        app.respondSwapp(button.dataset.id, button.dataset.status);
      });
    });

    document.querySelectorAll(".cancel-swapp-btn").forEach((button) => {
      button.addEventListener("click", () => {
        app.cancelSwapp(button.dataset.id, button.dataset.partner, button);
      });
    });

    root.lucide?.createIcons();
  };

  // FUNC-011 REQT-009, REQT-010: cancelling voids the SWAPP, both students
  // lose access to its notebooks, and its chat closes.
  app.cancelSwapp = async function cancelSwapp(id, partner, button) {
    const question =
      `Cancel your SWAPP with @${partner}?\n\n` +
      "You will both lose access to its notebooks and its chat will close.";
    if (!confirm(question)) return;

    if (button) button.disabled = true;
    try {
      await app.api.cancelSwapp(id);
      app.showToast("SWAPP cancelled.");
    } catch (err) {
      app.showToast(err.message || "Could not cancel the SWAPP. Please try again.");
      console.error(err);
    }
    await app.loadSwapps();
    // Reload the feed so file links the student can no longer open are gone.
    await app.loadNotebooks?.();
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
    if (changed) await app.loadNotebooks?.();
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
    try {
      await app.api.respondSwapp(id, { status });
      const actionText = status === "accepted" ? "accepted" : "denied";
      app.showToast(`Swap request ${actionText}!`);
    } catch (err) {
      app.showToast(err.message || "Failed to process request");
      console.error(err);
    }
    // Either way, show the request's real state (e.g. already answered).
    // Reloading the feed also brings the file links an accepted SWAPP unlocks.
    await app.loadSwapps();
    await app.loadNotebooks?.();
  };
})(window);
