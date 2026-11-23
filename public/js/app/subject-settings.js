(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});
  const LS_KEY = "swappr_subject_pref";

  // Subjects ticked while the modal is open. Kept here rather than read
  // from the checkboxes, so a search that re-renders the list keeps them.
  let pendingSubjects = new Set();

  function showSelectionError(show) {
    document.getElementById("subjectSettingsError")?.classList.toggle("hidden", !show);
  }

  app.getSubjectPref = function () {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY)) || { mode: "own" };
    } catch {
      return { mode: "own" };
    }
  };

  app.saveSubjectPref = function (pref) {
    localStorage.setItem(LS_KEY, JSON.stringify(pref));
  };

  app.openSubjectSettings = async function () {
    const modal = document.getElementById("subjectSettingsModal");
    if (!modal) return;

    const pref = app.getSubjectPref();

    document.querySelectorAll("[name=subjectMode]").forEach((r) => {
      r.checked = r.value === pref.mode;
    });

    pendingSubjects = new Set(pref.subjects || []);
    showSelectionError(false);
    app._syncSubjectModeUI(pref.mode);
    modal.classList.remove("hidden");
    root.lucide?.createIcons();

    // Always pre-fetch so the list is ready the moment "custom" is selected
    if (!app.state._allSubjects?.length) {
      const list = document.getElementById("subjectCheckboxList");
      if (list)
        list.innerHTML = `<p class="text-sm py-2 px-1">Loading subjects…</p>`;
      try {
        const data = await app.api.getSubjects("ALL");
        app.state._allSubjects = data.subjects || [];
      } catch {
        app.state._allSubjects = [];
      }
    }

    // Always render immediately — visible if custom, hidden otherwise
    app._renderSubjectCheckboxes(pref, "");
  };

  app._renderSubjectCheckboxes = function (pref, query) {
    const list = document.getElementById("subjectCheckboxList");
    if (!list) return;

    const selected = pendingSubjects;
    const q = (query ?? "").toLowerCase().trim();
    let subjects = app.state._allSubjects || [];

    if (q) {
      subjects = subjects.filter(
        (s) =>
          s.code.toLowerCase().includes(q) ||
          (s.description || "").toLowerCase().includes(q),
      );
    }

    if (subjects.length === 0) {
      list.innerHTML = `<p class="text-sm py-2 px-1">${q ? "No subjects match." : "No subjects found."}</p>`;
      return;
    }

    const groups = new Map();
    for (const subject of subjects) {
      const label = subject.reservedUnits?.join(" / ") || subject.department || "Unassigned";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(subject);
    }

    const content = document.createDocumentFragment();
    const ordered = [...groups].sort(([left], [right]) => left.localeCompare(right));
    for (const [department, items] of ordered) {
      const group = document.createElement("details");
      group.open = true;
      group.className = "mb-1";
      const heading = document.createElement("summary");
      heading.className = "panel-label cursor-pointer py-1.5 px-1 select-none";
      heading.append(department + " ");
      const count = document.createElement("span");
      count.className = "font-normal normal-case";
      count.textContent = `(${items.length})`;
      heading.append(count);

      const choices = document.createElement("div");
      choices.className = "pl-2";
      for (const subject of items) {
        const label = document.createElement("label");
        label.className = "flex items-start gap-2 py-1 cursor-pointer rounded px-1";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "subj-cb w-4 h-4 mt-0.5 shrink-0";
        checkbox.value = subject.code;
        checkbox.checked = selected.has(subject.code);
        const description = document.createElement("span");
        description.className = "text-sm leading-snug";
        const code = document.createElement("span");
        code.className = "font-semibold";
        code.textContent = subject.code;
        description.append(code, ` — ${subject.description || ""}`);
        label.append(checkbox, description);
        choices.append(label);
      }
      group.append(heading, choices);
      content.append(group);
    }
    list.replaceChildren(content);
  };

  app.closeSubjectSettings = function (event) {
    if (!event || event.target.id === "subjectSettingsModal") {
      document.getElementById("subjectSettingsModal")?.classList.add("hidden");
    }
  };

  app._syncSubjectModeUI = function (mode) {
    const container = document.getElementById("subjectCheckboxContainer");
    if (container) container.classList.toggle("hidden", mode !== "custom");
  };

  app.applySubjectSettings = function () {
    const mode =
      document.querySelector("[name=subjectMode]:checked")?.value || "own";
    const subjects = mode === "custom" ? [...pendingSubjects] : [];
    // MOD002: Choose subjects needs at least one ticked subject.
    if (mode === "custom" && subjects.length === 0) {
      showSelectionError(true);
      return;
    }
    app.saveSubjectPref({ mode, subjects });
    app.closeSubjectSettings();
    app.loadSubjects();
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[name=subjectMode]").forEach((radio) => {
      radio.addEventListener("change", () => {
        app._syncSubjectModeUI(radio.value);
        showSelectionError(false);
        // Re-render with current search query when switching to custom
        if (radio.value === "custom") {
          const q = document.getElementById("subjectSearch")?.value || "";
          app._renderSubjectCheckboxes(app.getSubjectPref(), q);
        }
      });
    });

    document
      .getElementById("subjectSearch")
      ?.addEventListener(
        "input",
        app.debounce((e) => {
          app._renderSubjectCheckboxes(app.getSubjectPref(), e.target.value);
        }),
      );

    // Ticking or unticking updates the pending selection.
    document.getElementById("subjectCheckboxList")?.addEventListener("change", (e) => {
      if (!e.target.classList.contains("subj-cb")) return;
      if (e.target.checked) pendingSubjects.add(e.target.value);
      else pendingSubjects.delete(e.target.value);
      if (pendingSubjects.size) showSelectionError(false);
    });

    // Escape closes without applying, like Close (x) and Cancel.
    document.addEventListener("keydown", (event) => {
      const modal = document.getElementById("subjectSettingsModal");
      if (event.key === "Escape" && modal && !modal.classList.contains("hidden")) {
        app.closeSubjectSettings();
      }
    });
  });

  root.openSubjectSettings = () => app.openSubjectSettings();
  root.closeSubjectSettings = (e) => app.closeSubjectSettings(e);
  root.applySubjectSettings = () => app.applySubjectSettings();
})(window);
