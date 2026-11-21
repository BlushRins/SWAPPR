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
      const courseParam = app.state.selectedProgram ||
        (useAll ? "ALL" : app.state.currentUser?.course || "");

      const data = await app.api.getSubjects(courseParam);
      let subjects = data.subjects || [];

      // For custom mode, filter client-side to only the handpicked subject codes
      if (!app.state.selectedProgram && pref.mode === "custom" && pref.subjects?.length) {
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

  function fillSubjects(select, placeholder) {
    if (!select) return;
    const selected = select.value;
    select.replaceChildren(new Option(placeholder, ""));
    for (const subject of app.state.subjects) {
      const option = new Option(`${subject.code} - ${subject.description || ""}`, subject.code);
      option.dataset.department = subject.department || "";
      select.appendChild(option);
    }
    select.value = [...select.options].some((option) => option.value === selected) ? selected : "";
  }

  app.populateSubjectDropdown = function populateSubjectDropdown() {
    fillSubjects(document.getElementById("newSubject"), "- Select subject -");
    const filter = document.getElementById("programSubject");
    if (app.state.selectedProgram && filter) {
      fillSubjects(filter, "All subjects");
      filter.value = filter.querySelector("option:checked")?.value || "";
    }
  };

  app.attachProgramSearch = function attachProgramSearch() {
    const form = document.getElementById("programSearchForm");
    const input = document.getElementById("programSearch");
    const options = document.getElementById("programOptions");
    const programs = root.SWAPPRCourses.COURSE_GROUPS.flatMap((group) => group.courses);
    for (const program of programs.sort()) options.appendChild(new Option(program));

    input.addEventListener("input", () => input.setCustomValidity(""));
    form.addEventListener("submit", (event) => {
      const match = programs.find((program) => program.toLowerCase() === input.value.trim().toLowerCase());
      if (!match) {
        event.preventDefault();
        input.setCustomValidity("Choose a degree program from the suggestions.");
        input.reportValidity();
        return;
      }
      input.value = match;
    });

    const program = new URLSearchParams(root.location.search).get("program");
    if (!root.SWAPPRCourses.isCourse(program)) return;
    app.state.selectedProgram = program;
    input.value = program;
    document.getElementById("programFilters").classList.remove("hidden");
    document.getElementById("programSubject").addEventListener("change", (event) => {
      app.state.selectedSubject = event.target.value || null;
      app.resetPagination();
      app.renderNotebooks();
    });
  };

  app.leaveProgramSearch = function leaveProgramSearch() {
    if (!app.state.selectedProgram) return;
    app.state.selectedProgram = null;
    const url = new URL(root.location.href);
    url.searchParams.delete("program");
    root.history.replaceState(null, "", url);
    document.getElementById("programSearch").value = "";
    document.getElementById("programFilters").classList.add("hidden");
    app.loadSubjects();
  };

  // Drill from a subject card into its aligned notebooks.
  app.selectSubject = function selectSubject(code) {
    app.state.selectedSubject = code;
    app.resetPagination();
    document.getElementById("backToSubjectsBtn")?.classList.remove("hidden");
    app.renderNotebooks();
  };

  app.clearSelectedSubject = function clearSelectedSubject() {
    app.state.selectedSubject = null;
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
            <h3 class="subject-title"></h3>
            <p class="subject-desc"></p>
          </div>
          <button class="subject-cta" type="button">View Swaps</button>
        </div>
      `;
      card.querySelector(".subject-title").textContent = subject.code;
      card.querySelector(".subject-desc").textContent = subject.description || "";
      card.querySelector(".subject-cta").addEventListener("click", () => app.selectSubject(subject.code));
      grid.appendChild(card);
    });
  };
})(window);
