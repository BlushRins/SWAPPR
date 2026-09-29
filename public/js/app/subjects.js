(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  app.loadDepartments = async function loadDepartments() {
    try {
      const data = await app.api.getDepartments();
      app.state.departments = data.departments || [];
      app.renderNotebooks();
    } catch (err) {
      console.error("Failed to load departments:", err);
    }
  };

  app.loadSubjects = async function loadSubjects() {
    try {
      const pref = app.getSubjectPref ? app.getSubjectPref() : { mode: "own" };
      const useAll = pref.mode === "all" || pref.mode === "custom";
      const courseParam = useAll
        ? "ALL"
        : app.state.currentUser?.course || "";

      const data = await app.api.getSubjects(courseParam);
      let subjects = data.subjects || [];

      // For custom mode, filter client-side to only the handpicked subject codes
      if (pref.mode === "custom" && pref.subjects?.length) {
        const sel = new Set(pref.subjects);
        subjects = subjects.filter((s) => sel.has(s.code));
      }

      app.state.subjects = subjects;
      app.state.codesWithNotebooks = new Set(data.codesWithNotebooks || []);
      app.populateSubjectDropdown();
      app.renderNotebooks();
    } catch (err) {
      console.error("Failed to load subjects:", err);
      app.state.subjects = [];
      // IDX001: tell the student instead of leaving the loading spinner.
      const grid = document.getElementById("notebookGrid");
      if (grid && app.state.currentFilter === "all" && !app.state.selectedSubject) {
        const message = document.createElement("p");
        message.className = "text-sm text-purple-400";
        message.textContent = "Could not load subjects. Please try again.";
        grid.replaceChildren(message);
      }
    }
  };

  // Upload-form picker: tag a notebook with one of the user's program subjects.
  app.populateSubjectDropdown = function populateSubjectDropdown() {
    const select = document.getElementById("newSubject");
    if (!select) return;

    select.innerHTML =
      `<option value="">- Select subject -</option>` +
      app.state.subjects
        .map(
          (subject) =>
            `<option value="${subject.code}" data-department="${subject.department || ""}">${subject.code} - ${subject.description || ""}</option>`,
        )
        .join("");
  };

  // Drill from a subject card into its aligned notebooks.
  app.selectSubject = function selectSubject(code, department) {
    app.state.selectedSubject = code;
    app.state.selectedSubjectDept = department || "";
    app.resetPagination();
    document.getElementById("backToSubjectsBtn")?.classList.remove("hidden");
    app.renderNotebooks();
  };

  app.clearSelectedSubject = function clearSelectedSubject() {
    app.state.selectedSubject = null;
    app.state.selectedSubjectDept = null;
    app.resetPagination();
    document.getElementById("backToSubjectsBtn")?.classList.add("hidden");
    app.renderNotebooks();
  };

  app.renderSubjectCards = function renderSubjectCards() {
    const grid = document.getElementById("notebookGrid");
    if (!grid) return;

    grid.innerHTML = "";
    grid.className = "subjects-list";

    const sectionTitle = document.getElementById("sectionTitle");
    if (sectionTitle) sectionTitle.textContent = "All Subjects";

    const sectionSubtitle = document.getElementById("sectionSubtitle");
    if (sectionSubtitle) {
      const pref = app.getSubjectPref ? app.getSubjectPref() : { mode: "own" };
      const subtitleMap = {
        own: "Subjects in your program. Browse shared study resources.",
        all: "Showing subjects from all departments.",
        custom: "Showing subjects from your selected departments.",
      };
      sectionSubtitle.textContent =
        subtitleMap[pref.mode] || subtitleMap.own;
    }

    if (app.state.subjects.length === 0) {
      grid.innerHTML = `<p class="text-sm text-purple-400">No subjects found for your program.</p>`;
      app.renderPagination(0);
      return;
    }

    // Cards only show subjects that have at least one notebook in the DB.
    // The dropdown (populateSubjectDropdown) still uses the full subject list.
    const have = app.state.codesWithNotebooks || new Set();
    const query =
      document.getElementById("searchInput")?.value?.toLowerCase().trim() || "";

    const cardSubjects = app.state.subjects.filter((s) => {
      if (!have.has(s.code)) return false;
      if (!query) return true;
      // At the All Subjects level, search filters cards by code + description.
      return (
        s.code.toLowerCase().includes(query) ||
        (s.description || "").toLowerCase().includes(query)
      );
    });

    if (cardSubjects.length === 0) {
      // textContent: the query is whatever the student typed.
      const empty = document.createElement("p");
      empty.className = "text-sm text-purple-400";
      empty.textContent = query
        ? `No subjects match "${query}".`
        : "No subjects with shared notebooks yet.";
      grid.replaceChildren(empty);
      app.renderPagination(0);
      return;
    }

    const visibleSubjects = app.getPaginatedItems(cardSubjects);
    app.renderPagination(cardSubjects.length);

    visibleSubjects.forEach((subject) => {
      const card = document.createElement("div");
      card.className = "subject-card fade-in";
      card.innerHTML = `
        <div class="subject-card-inner">
          <div>
            <h3 class="subject-title">${subject.code}</h3>
            <p class="subject-desc">${subject.description || ""}</p>
          </div>
          <button class="subject-cta" type="button">View Swaps</button>
        </div>
      `;
      card
        .querySelector(".subject-cta")
        .addEventListener("click", () =>
          app.selectSubject(subject.code, subject.department || ""),
        );
      grid.appendChild(card);
    });
  };
})(window);
