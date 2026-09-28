(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  app.renderRequests = function renderRequests() {
    const currentUser = app.state.currentUser;
    if (!currentUser) {
      return `<p class="text-sm text-purple-400">Please log in.</p>`;
    }

    const incoming = app.state.swapps.filter(
      (swapp) => swapp.receiver === currentUser.username && swapp.status === "pending",
    );

    if (incoming.length === 0) {
      return `<p class="text-sm text-purple-400 text-center py-8">No pending requests.</p>`;
    }

    return incoming
      .map(
        (swapp) => `
          <div class="p-5 rounded-xl bg-white dark:bg-[#181428] shadow border border-purple-100 dark:border-white/[0.06] mb-4">
            <div class="flex items-start justify-between mb-3">
              <div>
                <p class="text-sm font-bold text-purple-900 dark:text-purple-100">@${swapp.sender} wants to swap</p>
                <p class="text-xs text-purple-400 mt-1">Pending your approval</p>
              </div>
              <span class="text-xs px-2 py-1 rounded-full bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 font-medium">Pending</span>
            </div>
            <div class="flex gap-2 mt-4">
              <button class="respond-btn flex-1 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition" data-id="${swapp.id}" data-status="accepted">
                Accept
              </button>
              <button class="respond-btn flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold transition" data-id="${swapp.id}" data-status="rejected">
                Deny
              </button>
            </div>
          </div>
        `,
      )
      .join("");
  };

  app.attachRequestListeners = function attachRequestListeners() {
    document.querySelectorAll(".respond-btn").forEach((button) => {
      button.addEventListener("click", () => {
        app.respondSwapp(button.dataset.id, button.dataset.status);
      });
    });

    root.lucide?.createIcons();
  };

  app.loadSwapps = async function loadSwapps() {
    const currentUser = app.state.currentUser;
    if (!currentUser) return;

    try {
      const data = await app.api.getSwapps(currentUser.username);
      app.state.swapps = data.swapps || [];
      app.updateRequestBadge();
    } catch {}
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

  // The server takes the sender from the session.
  app.sendSwapp = async function sendSwapp(toUsername) {
    return app.api.sendSwapp({ to: toUsername });
  };

  app.respondSwapp = async function respondSwapp(id, status) {
    try {
      await app.api.respondSwapp(id, { status });
      const actionText = status === "accepted" ? "accepted" : "denied";
      app.showToast(`Swap request ${actionText}!`);

      await app.loadSwapps();
      if (app.state.currentFilter === "requests") app.renderNotebooks();
    } catch (err) {
      app.showToast("Failed to process request");
      console.error(err);
    }
  };
})(window);
