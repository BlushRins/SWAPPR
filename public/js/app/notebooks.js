(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  function currentSearchQuery() {
    return document.getElementById("searchInput")?.value?.toLowerCase() || "";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  }

  // Subtitles the design gives specific views (IDX004, IDX006).
  const VIEW_SUBTITLES = {
    matched: "Notebooks unlocked through your SWAPPs.",
    top: "The most active departments first.",
  };

  // What a view shows when it has nothing at all (IDX003, IDX004, IDX006,
  // IDX007). When a search empties it, FUNC-007 REQT-003 applies instead.
  const EMPTY_MESSAGES = {
    mine: "You have not shared any notebooks yet.",
    matched: "You have no SWAPP matches yet.",
    top: "No notebooks have been shared yet.",
    recent: "No notebooks have been shared yet.",
  };
  const NO_SEARCH_MATCH = "No notebooks match your search. Try adjusting your filters.";
  const RECENT_LIMIT = 20;

  // Newest upload first; the id breaks ties (notebooks saved the same second).
  function newestFirst(a, b) {
    return String(b.created_at || "").localeCompare(String(a.created_at || "")) || b.id - a.id;
  }

  // IDX006: departments with the most active notebooks first, ties by
  // department name, newest notebook first within a department. Activity is
  // counted over every active notebook, not just the ones a search leaves.
  function byDepartmentActivity(notebooks) {
    const activity = new Map();
    app.state.notebooks.forEach((notebook) => {
      const department = notebook.department || "";
      activity.set(department, (activity.get(department) || 0) + 1);
    });
    return [...notebooks].sort((a, b) => {
      const left = a.department || "";
      const right = b.department || "";
      if (left === right) return newestFirst(a, b);
      // Notebooks without a department go last.
      if (!left) return 1;
      if (!right) return -1;
      return activity.get(right) - activity.get(left) || left.localeCompare(right);
    });
  }

  function updateSectionTitle() {
    const sectionTitle = document.getElementById("sectionTitle");
    const sectionSubtitle = document.getElementById("sectionSubtitle");
    if (!sectionTitle) return;

    if (app.state.selectedSubject) {
      sectionTitle.textContent = app.state.selectedSubject;
      if (sectionSubtitle) {
        sectionSubtitle.textContent = "Notebooks for this subject";
      }
      return;
    }

    if (app.state.selectedDepartment) {
      sectionTitle.textContent = "All Notebooks";
      if (sectionSubtitle) {
        sectionSubtitle.textContent = "Discover and exchange study materials";
      }
      return;
    }

    sectionTitle.textContent =
      app.state.titles[app.state.currentFilter] || "Subjects";
    if (sectionSubtitle) {
      sectionSubtitle.textContent =
        VIEW_SUBTITLES[app.state.currentFilter] ||
        "Browse shared subjects and study resources in a Reddit-style feed.";
    }
  }

  function notebookMatchesSearch(notebook, searchQuery) {
    return (
      notebook.title.toLowerCase().includes(searchQuery) ||
      notebook.username.toLowerCase().includes(searchQuery)
    );
  }

  function filterNotebooks(searchQuery) {
    let filtered = [...app.state.notebooks];

    if (searchQuery) {
      filtered = filtered.filter((notebook) =>
        notebookMatchesSearch(notebook, searchQuery),
      );
    }

    if (app.state.selectedDepartment) {
      filtered = filtered.filter(
        (notebook) => notebook.department === app.state.selectedDepartment,
      );
    }

    if (app.state.selectedSubject) {
      const want = app.state.selectedSubject;
      const dept = app.state.selectedSubjectDept;
      // Exact course_code match, OR legacy untagged notebook whose department
      // matches the subject's department (the "backfill from department" path).
      filtered = filtered.filter(
        (notebook) =>
          notebook.course_code === want ||
          (!notebook.course_code && dept && notebook.department === dept),
      );
    }

    if (app.state.currentFilter === "mine") {
      filtered = filtered.filter(
        (notebook) => notebook.username === app.state.currentUser?.username,
      );
    }

    // FUNC-012 REQT-002: only the notebooks unlocked by confirmed SWAPPs.
    if (app.state.currentFilter === "matched") {
      const unlocked = app.unlockedNotebookIds();
      filtered = filtered.filter(
        (notebook) =>
          unlocked.has(notebook.id) &&
          notebook.username !== app.state.currentUser?.username,
      );
    }

    if (app.state.currentFilter === "top") {
      filtered = byDepartmentActivity(filtered);
    }

    // IDX007: the 20 most recently published, newest first.
    if (app.state.currentFilter === "recent") {
      filtered = [...filtered].sort(newestFirst).slice(0, RECENT_LIMIT);
    }

    return filtered;
  }

  function createActionControls(notebook, actionContainer) {
    const currentUser = app.state.currentUser;
    // Per-notebook SWAPP state from its Transaction_Manifest (FUNC-010,
    // FUNC-011 REQT-006). After a rejection the student can ask again.
    const { accessSwapp, pending, cancelled, declined } = app.swappStateFor(notebook);

    if (notebook.username === currentUser?.username) {
      const badge = document.createElement("span");
      badge.className = "text-xs text-purple-400 font-medium";
      badge.textContent = "Your Notebook";
      actionContainer.appendChild(badge);
      return;
    }

    // Report sits before whichever swap control follows, so every card that
    // isn't yours gets exactly one.
    const reportBtn = document.createElement("button");
    reportBtn.type = "button";
    reportBtn.innerHTML = '<i data-lucide="flag" class="w-4 h-4"></i>';
    reportBtn.className =
      "inline-flex items-center justify-center shrink-0 w-9 h-9 rounded-lg border border-gray-200 dark:border-purple-500/30 text-gray-400 dark:text-purple-300 hover:bg-red-50 hover:text-red-500 hover:border-red-200 dark:hover:bg-red-500/10 dark:hover:text-red-400 dark:hover:border-red-400/40 transition";
    reportBtn.title = "Report";
    reportBtn.setAttribute("aria-label", "Report this notebook");
    reportBtn.dataset.action = "report";
    reportBtn.addEventListener("click", () => app.openReportModal(notebook));
    actionContainer.appendChild(reportBtn);

    if (accessSwapp) {
      const accessBtn = document.createElement("button");
      accessBtn.innerHTML = '<i data-lucide="unlock" class="w-4 h-4"></i> Access';
      accessBtn.className =
        "text-sm px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition shadow-sm";
      accessBtn.dataset.action = "access";
      accessBtn.addEventListener("click", () => {
        if (notebook.fileUrl || notebook.file_url) {
          window.open(notebook.fileUrl || notebook.file_url, "_blank");
        } else {
          app.showToast("No file URL available");
        }
      });
      actionContainer.appendChild(accessBtn);

      // Opens the chat of the SWAPP that unlocked this notebook.
      const chatBtn = document.createElement("button");
      chatBtn.innerHTML = '<i data-lucide="message-circle" class="w-4 h-4"></i> Chat';
      chatBtn.className =
        "inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold transition shadow-sm ml-2";
      chatBtn.dataset.chatSwapp = String(accessSwapp.id);
      chatBtn.dataset.action = "chat";

      const unread = app.getChatUnreadForSwapp?.(accessSwapp.id) || 0;
      const chatBadge = document.createElement("span");
      chatBadge.dataset.chatButtonBadge = "";
      chatBadge.className =
        "bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1 inline-flex items-center justify-center";
      chatBadge.textContent = unread > 9 ? "9+" : String(unread);
      chatBadge.classList.toggle("hidden", unread === 0);
      chatBtn.appendChild(chatBadge);

      chatBtn.addEventListener("click", () => app.openChatForSwapp(accessSwapp.id));
      actionContainer.appendChild(chatBtn);
      return;
    }

    if (pending) {
      const pendingBadge = document.createElement("span");
      pendingBadge.className =
        "text-xs text-yellow-600 dark:text-yellow-400 font-medium";
      pendingBadge.textContent = "Swap Pending...";
      actionContainer.appendChild(pendingBadge);
      return;
    }

    // FUNC-011 REQT-009: the SWAPP that unlocked this notebook was cancelled.
    if (cancelled) {
      const cancelledLabel = document.createElement("span");
      cancelledLabel.className = "text-xs font-medium text-red-500 dark:text-red-400";
      cancelledLabel.textContent = "Cancelled";
      cancelledLabel.title = "The SWAPP for this notebook was cancelled. You can request it again.";
      actionContainer.appendChild(cancelledLabel);
    }

    // FUNC-011 REQT-008: let the requester see their last request was declined.
    if (declined) {
      const declinedLabel = document.createElement("span");
      declinedLabel.className = "text-xs font-medium text-red-500 dark:text-red-400";
      declinedLabel.textContent = "Declined";
      declinedLabel.title = "Your last request was declined. You can ask again.";
      actionContainer.appendChild(declinedLabel);
    }

    // FUNC-010 REQT-003: opens the prompt to choose which notebooks to offer.
    const swapBtn = document.createElement("button");
    swapBtn.innerHTML =
      '<i data-lucide="repeat-2" class="w-4 h-4"></i> Request Swap';
    swapBtn.className =
      "text-sm px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold transition shadow-sm";
    swapBtn.dataset.action = "swap";
    swapBtn.addEventListener("click", () => app.openSwappRequestModal(notebook));
    actionContainer.appendChild(swapBtn);
  }

  // The size label, count pills and reading time for a notebook. Each is left
  // out when the author didn't enter that count (IDX002). MOD004 uses the
  // same helper, so the card and the details always agree.
  app.notebookMetrics = function notebookMetrics(notebook) {
    const metricsApi = root.SWAPPRMetrics;
    const has = (value) => value !== null && value !== undefined && value !== "";
    const pills = [];
    if (has(notebook.wordCount)) {
      pills.push({ icon: "file-text", text: `${Number(notebook.wordCount).toLocaleString()} words` });
    }
    if (has(notebook.diagramCount)) {
      pills.push({ icon: "image", text: `${Number(notebook.diagramCount).toLocaleString()} diagrams` });
    }
    if (has(notebook.pageCount)) {
      pills.push({ icon: "book-open", text: `${Number(notebook.pageCount).toLocaleString()} pages` });
    }
    const minutes = metricsApi.readingMinutes(notebook.wordCount);
    return {
      size: metricsApi.sizeLabel(notebook.wordCount),
      pills,
      readTime: minutes === null ? null : `${minutes} min read`,
    };
  };

  // The card's action controls, also used by Notebook Details (MOD004).
  app.renderNotebookActions = function renderNotebookActions(notebook, container) {
    createActionControls(notebook, container);
  };

  function createNotebookCard(notebook) {
    const card = document.createElement("div");
    const maxDescLength = 140;
    const displayDesc = notebook.description
      ? notebook.description.length > maxDescLength
        ? `${notebook.description.slice(0, maxDescLength)}...`
        : notebook.description
      : "No description provided";

    const subjectLabel = escapeHtml(
      [notebook.department || "General", notebook.course_code, "Reviewer"]
        .filter(Boolean)
        .join(" \u2022 "),
    );
    // FUNC-007 REQT-002: the author's stored trust score.
    const trustScore = escapeHtml(notebook.trustScore ?? 100);
    const trustTone = app.trustTone(Number(notebook.trustScore ?? 100));
    const title = escapeHtml(notebook.title || "Untitled Notebook");
    const username = escapeHtml(notebook.username || "anonymous");
    const description = escapeHtml(displayDesc);
    const metrics = app.notebookMetrics(notebook);

    card.className = "notebook-card fade-in";
    card.innerHTML = `
      <div class="card-top">
        <div>
          <h3 class="card-title">
            <button type="button" class="card-title-link">${title}</button>
          </h3>
          <p class="card-username">by @${username}</p>
          <p class="card-description">${description}</p>
        </div>
      </div>

      <div class="card-subject-row">
        <span class="card-subject-text">${subjectLabel}</span>
      </div>

      ${metrics.size ? `<div class="card-badge-row"><span class="card-badge">${escapeHtml(metrics.size)}</span></div>` : ""}

      ${
        metrics.pills.length
          ? `<div class="metadata-dashboard">${metrics.pills
              .map(
                (pill) => `
        <div class="meta-pill">
          <i data-lucide="${pill.icon}" class="w-3.5 h-3.5"></i>
          ${escapeHtml(pill.text)}
        </div>`,
              )
              .join("")}</div>`
          : ""
      }

      <div class="meta-bottom-row">
        ${
          metrics.readTime
            ? `<div class="read-time">
          <i data-lucide="clock" class="w-3.5 h-3.5"></i>
          ${escapeHtml(metrics.readTime)}
        </div>`
            : "<div></div>"
        }
        <div class="trust-score trust-${trustTone}">
          <i data-lucide="shield-check" class="w-4 h-4"></i>
          ${trustScore}% Trust Score
        </div>
      </div>

      <div class="card-footer">
        <span class="footer-text">PREVIEW &bull; UNLOCK VIA SWAP</span>
        <div class="action-container"></div>
      </div>
    `;

    // FUNC-007 REQT-005: the title opens Notebook Details (MOD004).
    card
      .querySelector(".card-title-link")
      .addEventListener("click", () => app.openNotebookDetails(notebook.id));
    createActionControls(notebook, card.querySelector(".action-container"));
    return card;
  }

  app.loadNotebooks = async function loadNotebooks() {
    try {
      const data = await app.api.getNotebooks();
      app.state.notebooks = data.portfolios || [];

      const editNotebookId = sessionStorage.getItem("editNotebookId");
      if (editNotebookId) {
        sessionStorage.removeItem("editNotebookId");
        const notebook = app.state.notebooks.find(
          (item) => item.id === Number(editNotebookId),
        );
        if (notebook) app.openEditNotebookModal(notebook);
      }
      app.openNotebookDetailsIfRequested();

      app.renderNotebooks();
    } catch (err) {
      console.error("Failed to load notebooks:", err);
    }
  };

  app.renderNotebooks = function renderNotebooks() {
    const grid = document.getElementById("notebookGrid");
    if (!grid) return;

    const searchQuery = currentSearchQuery();
    // Top-level All Subjects view: search filters the subject cards, not
    // notebooks, so stay on the cards view even with a query present.
    if (
      !app.state.selectedDepartment &&
      !app.state.selectedSubject &&
      app.state.currentFilter === "all"
    ) {
      app.renderSubjectCards();
      return;
    }

    updateSectionTitle();
    grid.innerHTML = "";
    grid.className = "notebooks-grid";

    if (app.state.currentFilter === "requests") {
      grid.innerHTML = app.renderRequests();
      app.renderPagination(0);
      app.attachRequestListeners();
      return;
    }

    const filtered = filterNotebooks(searchQuery);
    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "text-sm text-purple-400";
      // A search that empties the view gets the SRS wording; a view that has
      // nothing at all gets its own message.
      empty.textContent =
        searchQuery && filterNotebooks("").length
          ? NO_SEARCH_MATCH
          : EMPTY_MESSAGES[app.state.currentFilter] || NO_SEARCH_MATCH;
      grid.appendChild(empty);
      app.renderPagination(0);
      return;
    }

    grid.className =
      app.state.selectedDepartment || app.state.selectedSubject
        ? "notebooks-grid"
        : "subjects-list";
    const visibleNotebooks = app.getPaginatedItems(filtered);
    app.renderPagination(filtered.length);

    visibleNotebooks.forEach((notebook) => {
      grid.appendChild(createNotebookCard(notebook));
    });

    root.lucide?.createIcons();
  };

  app.submitPortfolio = async function submitPortfolio() {
    const title = document.getElementById("newTitle").value;
    const description = document.getElementById("newDescription").value;
    const subjectSelect = document.getElementById("newSubject");
    const courseCode = subjectSelect?.value || "";
    // Derive department from the chosen subject so the legacy dept-fallback and
    // existing department filter keep working.
    const department =
      subjectSelect?.selectedOptions?.[0]?.dataset?.department || "";
    const fileUrl = document.getElementById("newFileUrl").value;
    const editingNotebookId = app.state.editingNotebookId;

    const fieldsValid = app.validateNotebookFields();
    const counts = app.readNotebookCounts();
    if (!fieldsValid || !counts) return;

    // FUNC-009 REQT-005 / REQT-007: "No" returns to the modal with the
    // edits kept; nothing is sent.
    if (editingNotebookId && !confirm("Are you sure you want to edit this notebook?")) {
      return;
    }

    try {
      const payload = {
        title,
        description,
        department,
        courseCode,
        fileUrl,
        ...counts,
        username: app.state.currentUser.username,
      };

      const data = editingNotebookId
        ? await app.api.updatePortfolio(editingNotebookId, payload)
        : await app.api.createPortfolio(payload);

      // FUNC-009 REQT-006 / FUNC-008 REQT-007 and REQT-008.
      const flagged = data.status === "under_review";
      if (editingNotebookId) app.showToast("Successfully edited notebook.");
      if (!editingNotebookId && !flagged) app.showToast("Notebook published.");
      if (flagged) {
        app.showToast("Notebook submitted. It will appear once an admin has reviewed it.");
      }
      app.closeAddModal();
      app.state.editingNotebookId = null;
      app.loadNotebooks();
      app.loadSubjects();
      app.loadSidebar();
    } catch (err) {
      // The server names the field it refused ("Missing input.").
      if (err.field) {
        app.setNotebookFieldError(err.field, true);
        return;
      }
      console.error("Could not save the notebook:", err);
      app.showToast(
        err.message === "Enter a whole number."
          ? err.message
          : "Could not save the notebook. Please try again.",
      );
    }
  };

  app.likeNotebook = async function likeNotebook(id) {
    await app.api.likeNotebook({
      username: app.state.currentUser.username,
      notebookId: id,
    });

    app.loadNotebooks();
    app.loadSidebar();
  };

  app.filterBy = function filterBy(type) {
    app.state.currentFilter = type;
    app.state.selectedDepartment = null;
    app.state.selectedSubject = null;
    app.state.selectedSubjectDept = null;
    app.resetPagination();
    document.getElementById("backToSubjectsBtn")?.classList.add("hidden");

    const sectionTitle = document.getElementById("sectionTitle");
    if (sectionTitle) {
      sectionTitle.textContent = app.state.titles[type] || "Notebooks";
    }

    document.querySelectorAll(".sidebar-link").forEach((link) => {
      link.classList.toggle("active", link.dataset.filter === type);
    });

    root.lucide?.createIcons();
    app.renderNotebooks();
  };
})(window);
