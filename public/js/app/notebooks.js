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
        "Browse shared subjects and study resources in a Reddit-style feed.";
    }
  }

  function notebookMatchesSearch(notebook, searchQuery) {
    return (
      notebook.title.toLowerCase().includes(searchQuery) ||
      notebook.username.toLowerCase().includes(searchQuery)
    );
  }

  function matchedUsernames() {
    const currentUser = app.state.currentUser;
    return app.state.swapps
      .filter((swapp) => swapp.status === "accepted")
      .map((swapp) =>
        swapp.sender === currentUser.username ? swapp.receiver : swapp.sender,
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

    if (app.state.currentFilter === "matched") {
      const matches = matchedUsernames();
      filtered = filtered.filter((notebook) => matches.includes(notebook.username));
    }

    if (app.state.currentFilter === "top") {
      const userCounts = {};
      app.state.notebooks.forEach((notebook) => {
        userCounts[notebook.username] = (userCounts[notebook.username] || 0) + 1;
      });

      const topUsers = Object.entries(userCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([username]) => username);

      filtered = filtered.filter((notebook) => topUsers.includes(notebook.username));
    }

    if (app.state.currentFilter === "recent") {
      filtered = [...filtered].reverse().slice(0, 20);
    }

    return filtered;
  }

  function createActionControls(notebook, actionContainer) {
    const currentUser = app.state.currentUser;
    const hasSwapp = app.state.swapps.some(
      (swapp) =>
        ((swapp.sender === currentUser?.username && swapp.receiver === notebook.username) ||
          (swapp.receiver === currentUser?.username && swapp.sender === notebook.username)) &&
        swapp.status === "accepted",
    );

    const canSwapp =
      currentUser &&
      notebook.username !== currentUser.username &&
      !app.state.swapps.some(
        (swapp) =>
          (swapp.sender === currentUser.username && swapp.receiver === notebook.username) ||
          (swapp.receiver === currentUser.username && swapp.sender === notebook.username),
      );

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
    reportBtn.addEventListener("click", () => app.openReportModal(notebook));
    actionContainer.appendChild(reportBtn);

    if (hasSwapp) {
      const accessBtn = document.createElement("button");
      accessBtn.innerHTML = '<i data-lucide="unlock" class="w-4 h-4"></i> Access';
      accessBtn.className =
        "text-sm px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition shadow-sm";
      accessBtn.addEventListener("click", () => {
        if (notebook.fileUrl || notebook.file_url) {
          window.open(notebook.fileUrl || notebook.file_url, "_blank");
        } else {
          app.showToast("No file URL available");
        }
      });
      actionContainer.appendChild(accessBtn);

      const chatBtn = document.createElement("button");
      chatBtn.innerHTML = '<i data-lucide="message-circle" class="w-4 h-4"></i> Chat';
      chatBtn.className =
        "inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold transition shadow-sm ml-2";
      chatBtn.dataset.chatUser = notebook.username;

      const unread = app.getChatUnreadFor?.(notebook.username) || 0;
      const chatBadge = document.createElement("span");
      chatBadge.dataset.chatButtonBadge = "";
      chatBadge.className =
        "bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1 inline-flex items-center justify-center";
      chatBadge.textContent = unread > 9 ? "9+" : String(unread);
      chatBadge.classList.toggle("hidden", unread === 0);
      chatBtn.appendChild(chatBadge);

      chatBtn.addEventListener("click", () => app.openChatForNotebook(notebook.username));
      actionContainer.appendChild(chatBtn);
      return;
    }

    if (canSwapp) {
      const swapBtn = document.createElement("button");
      swapBtn.innerHTML =
        '<i data-lucide="repeat-2" class="w-4 h-4"></i> Request Swap';
      swapBtn.className =
        "text-sm px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold transition shadow-sm";
      swapBtn.addEventListener("click", async () => {
        swapBtn.disabled = true;
        swapBtn.textContent = "Sending...";

        try {
          await app.sendSwapp(notebook.username);
          app.showToast("Swap request sent!");
          await app.loadSwapps();
          app.renderNotebooks();
        } catch (err) {
          // FUNC-010 REQT-008: no notebook to offer, so offer to upload one.
          if (err.code === "NO_NOTEBOOKS") {
            if (confirm(`${err.message}\n\nUpload one now?`)) app.openAddModal();
            return;
          }
          app.showToast(err.message || "Failed to send request");
          console.error(err);
          // The request may have been refused because the swap state changed
          // (e.g. sent from another tab), so show the current state.
          await app.loadSwapps().catch(() => {});
          app.renderNotebooks();
        } finally {
          swapBtn.disabled = false;
          swapBtn.innerHTML =
            '<i data-lucide="repeat-2" class="w-4 h-4"></i> Request Swap';
          root.lucide?.createIcons();
        }
      });
      actionContainer.appendChild(swapBtn);
      return;
    }

    const pendingBadge = document.createElement("span");
    pendingBadge.className =
      "text-xs text-yellow-600 dark:text-yellow-400 font-medium";
    pendingBadge.textContent = "Swap Pending...";
    actionContainer.appendChild(pendingBadge);
  }

  function createNotebookCard(notebook) {
    const card = document.createElement("div");
    const maxDescLength = 140;
    const displayDesc = notebook.description
      ? notebook.description.length > maxDescLength
        ? `${notebook.description.slice(0, maxDescLength)}...`
        : notebook.description
      : "No description provided";

    const wordCount = notebook.wordCount || Math.floor(Math.random() * 12000) + 2000;
    const subjectLabel = escapeHtml(notebook.department || notebook.course || "General");
    const trustScore = escapeHtml(notebook.trustScore || 98);
    const levelTag =
      notebook.level ||
      (wordCount > 15000
        ? "COMPREHENSIVE"
        : wordCount > 8000
          ? "COMPREHENSIVE"
          : wordCount > 4000
            ? "STANDARD"
            : "QUICK REVIEW");
    const title = escapeHtml(notebook.title || "Untitled Notebook");
    const username = escapeHtml(notebook.username || "anonymous");
    const description = escapeHtml(displayDesc);
    const levelTagText = escapeHtml(levelTag);
    const wordCountText = escapeHtml(wordCount.toLocaleString());

    card.className = "notebook-card fade-in";
    card.innerHTML = `
      <div class="card-top">
        <div>
          <h3 class="card-title">${title}</h3>
          <p class="card-username">by @${username}</p>
          <p class="card-description">${description}</p>
        </div>
      </div>

      <div class="card-subject-row">
        <span class="card-subject-text">${subjectLabel} &bull; COURSE &bull; Reviewer</span>
      </div>

      <div class="card-badge-row">
        <span class="card-badge">${levelTagText}</span>
      </div>

      <div class="metadata-dashboard">
        <div class="meta-pill">
          <i data-lucide="file-text" class="w-3.5 h-3.5"></i>
          ${wordCountText} words
        </div>
        <div class="meta-pill">
          <i data-lucide="image" class="w-3.5 h-3.5"></i>
          ${escapeHtml(notebook.imageCount || 18)} diagrams
        </div>
        <div class="meta-pill">
          <i data-lucide="book-open" class="w-3.5 h-3.5"></i>
          ${escapeHtml(notebook.pageCount || 72)} pages
        </div>
      </div>

      <div class="meta-bottom-row">
        <div class="read-time">
          <i data-lucide="clock" class="w-3.5 h-3.5"></i>
          ${escapeHtml(notebook.readTime || 48)} min read
        </div>
        <div class="trust-score">
          <i data-lucide="shield-check" class="w-4 h-4"></i>
          ${trustScore}% Trust Score
        </div>
      </div>

      <div class="card-footer">
        <span class="footer-text">PREVIEW &bull; UNLOCK VIA SWAP</span>
        <div class="action-container"></div>
      </div>
    `;

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
      grid.innerHTML = `<p class="text-sm text-purple-400">No results found.</p>`;
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

    if (!title) return alert("Title required");

    try {
      const payload = {
        title,
        description,
        department,
        courseCode,
        fileUrl,
        username: app.state.currentUser.username,
      };

      const data = editingNotebookId
        ? await app.api.updatePortfolio(editingNotebookId, payload)
        : await app.api.createPortfolio(payload);

      if (!data.success) {
        app.showToast(data.message || "Failed to save notebook");
        return;
      }

      app.showToast(editingNotebookId ? "Notebook updated!" : "Notebook created!");
      app.closeAddModal();
      app.state.editingNotebookId = null;
      app.loadNotebooks();
      app.loadSidebar();
    } catch (err) {
      console.error(err);
      app.showToast("Server error");
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
