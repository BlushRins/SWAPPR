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
        list.innerHTML = `<p class="text-sm text-purple-400 py-2 px-1">Loading subjects…</p>`;
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
      list.innerHTML = `<p class="text-sm text-purple-400 py-2 px-1">${q ? "No subjects match." : "No subjects found."}</p>`;
      return;
    }

    // Group by department
    const groups = {};
    subjects.forEach((s) => {
      const dept = s.department || "Other";
      if (!groups[dept]) groups[dept] = [];
      groups[dept].push(s);
    });

    list.innerHTML = Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([dept, items]) => `
          <details open class="mb-1">
            <summary class="cursor-pointer text-xs font-bold uppercase tracking-widest text-purple-500 dark:text-purple-400 py-1.5 px-1 select-none hover:text-purple-700 dark:hover:text-purple-200 transition">
              ${dept} <span class="font-normal normal-case text-gray-400">(${items.length})</span>
            </summary>
            <div class="pl-2">
              ${items
                .map(
                  (s) => `
                <label class="flex items-start gap-2 py-1 cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded px-1">
                  <input type="checkbox" class="subj-cb accent-purple-600 w-4 h-4 mt-0.5 shrink-0"
                    value="${s.code}" ${selected.has(s.code) ? "checked" : ""}>
                  <span class="text-sm leading-snug">
                    <span class="font-semibold text-gray-800 dark:text-purple-100">${s.code}</span>
                    <span class="text-gray-500 dark:text-gray-400"> — ${s.description || ""}</span>
                  </span>
                </label>`,
                )
                .join("")}
            </div>
          </details>`,
      )
      .join("");
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
      ?.addEventListener("input", (e) => {
        app._renderSubjectCheckboxes(app.getSubjectPref(), e.target.value);
      });

    // Ticking or unticking updates the pending selection.
    document.getElementById("subjectCheckboxList")?.addEventListener("change", (e) => {
      if (!e.target.classList.contains("subj-cb")) return;
      if (e.target.checked) pendingSubjects.add(e.target.value);
      else pendingSubjects.delete(e.target.value);
      if (pendingSubjects.size) showSelectionError(false);
    });
  });

  root.openSubjectSettings = () => app.openSubjectSettings();
  root.closeSubjectSettings = (e) => app.closeSubjectSettings(e);
  root.applySubjectSettings = () => app.applySubjectSettings();
})(window);
