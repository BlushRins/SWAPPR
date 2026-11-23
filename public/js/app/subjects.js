(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // Subject titles are stored in upper case (courses.db). Small joining words
  // stay lower case and Roman numerals stay upper case: "Web Development II".
  const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "for", "in", "of", "on", "or", "the", "to", "with"]);
  app.titleCase = function titleCase(text) {
    return String(text ?? "")
      .toLowerCase()
      .split(" ")
      .map((word, index) => {
        if (/^[ivx]+$/.test(word)) return word.toUpperCase();
        if (index > 0 && SMALL_WORDS.has(word)) return word;
        return word.replace(/^\w/, (ch) => ch.toUpperCase());
      })
      .join(" ");
  };

  // "CIS2101", "cis 2101" and "CIS 2101" all find CIS 2101.
  function compact(text) {
    return String(text ?? "").toLowerCase().replace(/\s+/g, "");
  }

  // A next-step button for empty and failed states (Clear search, Try again).
  app.stateMessage = function stateMessage(text, actionLabel, onAction) {
    const wrapper = document.createElement("div");
    wrapper.className = "feed-state";
    const message = document.createElement("p");
    message.textContent = text;
    wrapper.appendChild(message);
    if (actionLabel) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "btn-outline";
      action.textContent = actionLabel;
      action.addEventListener("click", onAction);
      wrapper.appendChild(action);
    }
    return wrapper;
  };

  app.clearSearch = function clearSearch() {
    const input = document.getElementById("searchInput");
    if (input) input.value = "";
    app.resetPagination();
    app.renderNotebooks();
    input?.focus();
  };

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
      app.state.subjectsError = false;
      app.state.codesWithNotebooks = new Set(data.codesWithNotebooks || []);
      app.populateSubjectDropdown();
      app.renderNotebooks();
    } catch (err) {
      console.error("Failed to load subjects:", err);
      app.state.subjects = [];
      app.state.subjectsError = true;
      // IDX001: tell the student instead of leaving the loading spinner.
      app.renderNotebooks();
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
    document.getElementById("programPicker").open = true;
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
    document.getElementById("programPicker").open = false;
    document.getElementById("programFilters").classList.add("hidden");
    app.loadSubjects();
  };

  // Drill from a subject row into its notebooks. The subject search and
  // page are kept aside, so Back returns to the same filtered list; the
  // search box then filters this subject's notebooks instead.
  let savedBrowse = null;

  app.selectSubject = function selectSubject(code) {
    const input = document.getElementById("searchInput");
    savedBrowse = { query: input?.value || "", page: app.state.currentPage };
    if (input) input.value = "";
    app.state.selectedSubject = code;
    app.resetPagination();
    document.getElementById("backToSubjectsBtn")?.classList.remove("hidden");
    app.renderNotebooks();
    document.getElementById("sectionTitle")?.focus();
  };

  app.clearSelectedSubject = function clearSelectedSubject() {
    const input = document.getElementById("searchInput");
    app.state.selectedSubject = null;
    app.resetPagination();
    if (savedBrowse) {
      if (input) input.value = savedBrowse.query;
      app.state.currentPage = savedBrowse.page;
      savedBrowse = null;
    }
    document.getElementById("backToSubjectsBtn")?.classList.add("hidden");
    app.renderNotebooks();
    document.getElementById("sectionTitle")?.focus();
  };

  // Leaving the subject by another route (sidebar, program search) forgets
  // the saved browse state.
  app.forgetSavedBrowse = function forgetSavedBrowse() {
    savedBrowse = null;
  };

  app.renderSubjectCards = function renderSubjectCards() {
    const grid = document.getElementById("notebookGrid");
    if (!grid) return;

    grid.innerHTML = "";
    grid.className = "subjects-list";

    const sectionTitle = document.getElementById("sectionTitle");
    if (sectionTitle) sectionTitle.textContent = app.state.titles.all;

    const sectionSubtitle = document.getElementById("sectionSubtitle");
    if (sectionSubtitle) {
      const pref = app.getSubjectPref ? app.getSubjectPref() : { mode: "own" };
      const subtitleMap = {
        own: "Subjects in your degree program that have shared notebooks.",
        all: "Subjects from every department that have shared notebooks.",
        custom: "Subjects you chose that have shared notebooks.",
      };
      sectionSubtitle.textContent =
        subtitleMap[pref.mode] || subtitleMap.own;
    }

    if (app.state.subjectsError) {
      grid.replaceChildren(
        app.stateMessage("Couldn't load subjects.", "Try again", () => {
          grid.replaceChildren(app.stateMessage("Loading subjects…"));
          app.loadSubjects();
        }),
      );
      app.renderPagination(0);
      return;
    }

    if (app.state.subjects.length === 0) {
      grid.replaceChildren(app.stateMessage("No subjects found for your degree program."));
      app.renderPagination(0);
      return;
    }

    // Rows only show subjects that have at least one notebook in the DB.
    // The dropdown (populateSubjectDropdown) still uses the full subject list.
    const have = app.state.codesWithNotebooks || new Set();
    const rawQuery = document.getElementById("searchInput")?.value?.trim() || "";
    const query = compact(rawQuery);

    const cardSubjects = app.state.subjects.filter((s) => {
      if (!have.has(s.code)) return false;
      if (!query) return true;
      // At the Browse subjects level, search matches code and name.
      return compact(s.code).includes(query) || compact(s.description).includes(query);
    });

    if (cardSubjects.length === 0) {
      // textContent: the query is whatever the student typed.
      grid.replaceChildren(
        query
          ? app.stateMessage(`No subjects match "${rawQuery}".`, "Clear search", app.clearSearch)
          : app.stateMessage("No subjects with shared notebooks yet."),
      );
      app.renderPagination(0);
      return;
    }

    const visibleSubjects = app.getPaginatedItems(cardSubjects);
    app.renderPagination(cardSubjects.length);

    // Notebooks already loaded for the feed give each subject a real count.
    const counts = new Map();
    for (const notebook of app.state.notebooks || []) {
      counts.set(notebook.course_code, (counts.get(notebook.course_code) || 0) + 1);
    }

    const list = document.createElement("ul");
    list.className = "subject-rows";
    visibleSubjects.forEach((subject) => {
      const item = document.createElement("li");
      // The whole row opens the subject; one target, one label.
      const row = document.createElement("button");
      row.type = "button";
      row.className = "subject-row";
      row.setAttribute("aria-label", `View notebooks for ${subject.code}`);

      const text = document.createElement("span");
      text.className = "subject-row-text";
      const name = document.createElement("span");
      name.className = "subject-row-name";
      name.textContent = subject.description ? app.titleCase(subject.description) : subject.code;
      const code = document.createElement("span");
      code.className = "subject-row-code";
      code.textContent = subject.code;
      text.append(name, code);

      const side = document.createElement("span");
      side.className = "subject-row-side";
      const count = counts.get(subject.code);
      if (count) {
        const countEl = document.createElement("span");
        countEl.className = "subject-row-count num";
        countEl.textContent = `${count} notebook${count === 1 ? "" : "s"}`;
        side.appendChild(countEl);
      }
      const action = document.createElement("span");
      action.className = "subject-row-action";
      action.textContent = "View notebooks";
      const chevron = document.createElement("i");
      chevron.dataset.lucide = "chevron-right";
      chevron.className = "w-4 h-4";
      chevron.setAttribute("aria-hidden", "true");
      side.append(action, chevron);

      row.append(text, side);
      row.addEventListener("click", () => app.selectSubject(subject.code));
      item.appendChild(row);
      list.appendChild(item);
    });
    grid.appendChild(list);
    root.lucide?.createIcons();
  };
})(window);
