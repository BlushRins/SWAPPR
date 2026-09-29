(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // Notebook Details (MOD004): every card field in full plus the actions the
  // student can take (FUNC-007 REQT-005, FUNC-009 REQT-002 / 008 to 011,
  // FUNC-014 REQT-004). User text is always set with textContent.

  // profile.html's notebook titles set this and send the student here.
  const HANDOFF_KEY = "openNotebookId";

  const STATUS_LABELS = {
    active: "Active",
    under_review: "Under review",
    removed: "Removed",
  };

  // Actions that open another dialog or panel close this one first.
  const CLOSES_DETAILS = new Set(["report", "swap", "chat"]);

  let current = null;

  function $(id) {
    return document.getElementById(id);
  }

  // Subject titles are stored in upper case (courses.db). Small joining words
  // stay lower case and Roman numerals stay upper case: "Web Development II".
  const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "for", "in", "of", "on", "or", "the", "to", "with"]);
  function titleCase(text) {
    return String(text)
      .toLowerCase()
      .split(" ")
      .map((word, index) => {
        if (/^[ivx]+$/.test(word)) return word.toUpperCase();
        if (index > 0 && SMALL_WORDS.has(word)) return word;
        return word.replace(/^\w/, (ch) => ch.toUpperCase());
      })
      .join(" ");
  }

  // "{code} · {title}"; just the code when the subject isn't loaded.
  function subjectText(notebook) {
    if (!notebook.course_code) return "—";
    const subject = (app.state.subjects || []).find(
      (item) => item.code === notebook.course_code,
    );
    return subject?.description
      ? `${notebook.course_code} · ${titleCase(subject.description)}`
      : notebook.course_code;
  }

  // Feed notebooks are already loaded, so opening one sends no request. The
  // author's own notebooks under review aren't in the feed; those come from
  // the caller (PNL001) or the author's profile.
  async function findNotebook(id, fallback) {
    const inFeed = app.state.notebooks.find((notebook) => notebook.id === id);
    if (inFeed) return inFeed;
    if (fallback) return fallback;

    const me = app.state.currentUser;
    const data = await app.api.getProfile(me.username);
    const own = data.profile.portfolios.find((notebook) => notebook.id === id);
    return own
      ? { ...own, username: me.username, trustScore: data.profile.trustScore }
      : null;
  }

  function button(className, iconName, label) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    const icon = document.createElement("i");
    icon.dataset.lucide = iconName;
    icon.className = "w-4 h-4";
    element.append(icon, document.createTextNode(` ${label}`));
    return element;
  }

  function renderMetrics(notebook) {
    const container = $("detailsMetrics");
    container.replaceChildren();
    const metrics = app.notebookMetrics(notebook);

    if (metrics.size) {
      const badge = document.createElement("span");
      badge.className = "card-badge";
      badge.textContent = metrics.size;
      container.appendChild(badge);
    }
    const pills = [...metrics.pills];
    if (metrics.readTime) pills.push({ icon: "clock", text: metrics.readTime });
    pills.forEach((pill) => {
      const element = document.createElement("span");
      element.className = "meta-pill";
      const icon = document.createElement("i");
      icon.dataset.lucide = pill.icon;
      icon.className = "w-3.5 h-3.5";
      element.append(icon, document.createTextNode(` ${pill.text}`));
      container.appendChild(element);
    });
    container.classList.toggle("hidden", !container.children.length);
  }

  function renderLikeButton(notebook) {
    const likeBtn = document.createElement("button");
    likeBtn.type = "button";
    likeBtn.className = "like-btn";
    likeBtn.setAttribute("aria-label", "Like this notebook");
    const count = () => `♥ ${Number(notebook.likes || 0)}`;
    likeBtn.textContent = count();

    // DSN-03: one like per student per notebook.
    likeBtn.addEventListener("click", async () => {
      likeBtn.disabled = true;
      try {
        const data = await app.api.likeNotebook({ notebookId: notebook.id });
        if (!data.success) {
          app.showToast(data.message || "Already liked");
          return;
        }
        notebook.likes = Number(notebook.likes || 0) + 1;
        likeBtn.textContent = count();
        app.loadSidebar();
      } catch (err) {
        app.showToast(err.message || "Could not like this notebook.");
      } finally {
        likeBtn.disabled = false;
      }
    });
    return likeBtn;
  }

  // FUNC-009 REQT-008 to REQT-011.
  async function deleteNotebook(notebook) {
    // No keeps the student on the details (REQT-010).
    if (!confirm("Are you sure you want to delete this notebook?")) return;
    try {
      await app.api.deletePortfolio(notebook.id);
    } catch (err) {
      // REQT-011: the notebook is in an open SWAPP.
      app.showToast(err.message || "Could not delete the notebook.");
      return;
    }
    app.closeNotebookDetails();
    app.showToast("Notebook deleted.");
    // REQT-009: back to My Subjects with the notebook gone.
    app.filterBy("mine");
    app.loadNotebooks();
    app.loadSubjects();
    app.loadSidebar();
  }

  function renderActions(notebook, isOwn) {
    const container = $("detailsActions");
    container.replaceChildren(renderLikeButton(notebook));

    if (!isOwn) {
      // Same state rules as the card: Report, Request Swap / Swap Pending /
      // Declined / Cancelled / Access + Chat.
      const cardActions = document.createElement("div");
      cardActions.className = "flex flex-wrap items-center gap-2 ml-auto";
      app.renderNotebookActions(notebook, cardActions);
      container.appendChild(cardActions);
      return;
    }

    const ownActions = document.createElement("div");
    ownActions.className = "flex flex-wrap items-center gap-2 ml-auto";
    if (notebook.status !== "removed") {
      const editBtn = button(
        "inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold transition shadow-sm",
        "pencil",
        "Edit",
      );
      editBtn.addEventListener("click", () => {
        app.closeNotebookDetails();
        app.openEditNotebookModal(notebook);
      });
      ownActions.appendChild(editBtn);
    }
    const deleteBtn = button(
      "inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border-2 border-red-200 dark:border-red-400/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 font-semibold transition",
      "trash-2",
      "Delete",
    );
    deleteBtn.addEventListener("click", () => deleteNotebook(notebook));
    ownActions.appendChild(deleteBtn);
    container.appendChild(ownActions);
  }

  function render(notebook) {
    const isOwn = notebook.username === app.state.currentUser?.username;

    $("detailsTitle").textContent = notebook.title || "Untitled Notebook";
    const author = $("detailsAuthor");
    author.textContent = `by @${notebook.username || "anonymous"}`;
    author.href = `profile.html?user=${encodeURIComponent(notebook.username || "")}`;
    $("detailsDescription").textContent =
      notebook.description || "No description provided";
    $("detailsSubject").textContent = subjectText(notebook);
    $("detailsDepartment").textContent = notebook.department || "—";
    $("detailsUploaded").textContent =
      root.SWAPPRDates.formatLongDate(notebook.created_at) || "—";

    // Only the author ever sees a notebook that isn't active.
    const status = notebook.status || "active";
    $("detailsStatusLabel").classList.toggle("hidden", !isOwn);
    $("detailsStatus").classList.toggle("hidden", !isOwn);
    $("detailsStatus").textContent = STATUS_LABELS[status] || status;

    renderMetrics(notebook);

    const score = Number(notebook.trustScore ?? 100);
    const trust = $("detailsTrust");
    trust.className = `mt-4 inline-flex items-center gap-1.5 text-sm font-bold ${app
      .trustToneClasses(score)
      .join(" ")}`;
    $("detailsTrustText").textContent = `${score}% Trust Score`;

    renderActions(notebook, isOwn);
  }

  app.openNotebookDetails = async function openNotebookDetails(id, fallback) {
    let notebook;
    try {
      notebook = await findNotebook(Number(id), fallback);
    } catch (err) {
      console.error("Could not load notebook:", err);
    }
    if (!notebook) {
      app.showToast("This notebook is no longer available.");
      return;
    }

    current = notebook;
    render(notebook);
    $("notebookDetailsModal").classList.remove("hidden");
    root.lucide?.createIcons();
  };

  app.closeNotebookDetails = function closeNotebookDetails(event) {
    if (event && event.target.id !== "notebookDetailsModal") return;
    $("notebookDetailsModal")?.classList.add("hidden");
    current = null;
  };

  // Picks up a notebook title clicked on profile.html, once the feed is loaded.
  app.openNotebookDetailsIfRequested = function openNotebookDetailsIfRequested() {
    const id = sessionStorage.getItem(HANDOFF_KEY);
    if (!id) return;
    sessionStorage.removeItem(HANDOFF_KEY);
    app.openNotebookDetails(Number(id));
  };

  document.addEventListener("DOMContentLoaded", () => {
    $("detailsActions")?.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (current && CLOSES_DETAILS.has(action)) app.closeNotebookDetails();
    });

    document.addEventListener("keydown", (event) => {
      const modal = $("notebookDetailsModal");
      if (event.key === "Escape" && modal && !modal.classList.contains("hidden")) {
        app.closeNotebookDetails();
      }
    });
  });
})(window);
