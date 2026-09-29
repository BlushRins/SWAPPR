(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // The optional count inputs, keyed by the name the API expects.
  const COUNT_FIELDS = {
    wordCount: "newWordCount",
    pageCount: "newPageCount",
    diagramCount: "newDiagramCount",
  };

  function setCountError(key, hasError) {
    document.getElementById(COUNT_FIELDS[key])?.classList.toggle("error", hasError);
    document.getElementById(`${COUNT_FIELDS[key]}Error`)?.classList.toggle("hidden", !hasError);
  }

  // Reads the counts; marks each one that isn't a whole number. Returns null
  // if any is invalid, otherwise { wordCount, pageCount, diagramCount }.
  app.readNotebookCounts = function readNotebookCounts() {
    const counts = {};
    let valid = true;
    for (const [key, id] of Object.entries(COUNT_FIELDS)) {
      const parsed = root.SWAPPRMetrics.parseCount(
        document.getElementById(id)?.value,
        root.SWAPPRMetrics.COUNT_DIGITS[key],
      );
      setCountError(key, !parsed.ok);
      if (parsed.ok) counts[key] = parsed.value;
      else valid = false;
    }
    return valid ? counts : null;
  };

  app.clearPortfolioForm = function clearPortfolioForm() {
    const titleInput = document.getElementById("newTitle");
    const descriptionInput = document.getElementById("newDescription");
    const subjectInput = document.getElementById("newSubject");
    const fileUrlInput = document.getElementById("newFileUrl");
    const actionBtn = document.getElementById("portfolioActionBtn");

    if (titleInput) titleInput.value = "";
    if (descriptionInput) descriptionInput.value = "";
    if (subjectInput) subjectInput.value = "";
    if (fileUrlInput) fileUrlInput.value = "";
    Object.entries(COUNT_FIELDS).forEach(([key, id]) => {
      const input = document.getElementById(id);
      if (input) input.value = "";
      setCountError(key, false);
    });
    if (actionBtn) actionBtn.textContent = "Publish Notebook";
  };

  app.openAddModal = function openAddModal() {
    app.state.editingNotebookId = null;
    document.getElementById("modalHeading").textContent = "New Notebook";
    app.clearPortfolioForm();

    // Pre-select the subject the user drilled into, if any.
    if (app.state.selectedSubject) {
      selectSubject(app.state.selectedSubject);
    }

    document.getElementById("addModal").classList.remove("hidden");
    setTimeout(() => root.lucide?.createIcons(), 100);
  };

  // Form-prefill helper: set the upload form's subject select to `code`,
  // adding an option if the code isn't already in the list.
  function selectSubject(code) {
    const subjectInput = document.getElementById("newSubject");
    if (!subjectInput || !code) return;

    const existingOption = Array.from(subjectInput.options).find(
      (option) => option.value === code,
    );

    if (existingOption) {
      subjectInput.value = code;
      return;
    }

    const customOption = document.createElement("option");
    customOption.value = code;
    customOption.text = code;
    subjectInput.appendChild(customOption);
    subjectInput.value = code;
  }

  app.openEditNotebookModal = function openEditNotebookModal(notebook) {
    app.state.editingNotebookId = notebook.id;
    document.getElementById("modalHeading").textContent = "Edit Notebook";
    document.getElementById("newTitle").value = notebook.title || "";
    document.getElementById("newDescription").value = notebook.description || "";
    selectSubject(notebook.course_code || "");
    document.getElementById("newFileUrl").value = notebook.file_url || "";
    Object.entries(COUNT_FIELDS).forEach(([key, id]) => {
      const input = document.getElementById(id);
      if (input) input.value = notebook[key] ?? "";
      setCountError(key, false);
    });

    const actionBtn = document.getElementById("portfolioActionBtn");
    if (actionBtn) actionBtn.textContent = "Save Changes";

    document.getElementById("addModal").classList.remove("hidden");
    setTimeout(() => root.lucide?.createIcons(), 100);
  };

  // A count stops being red once it's valid again.
  document.addEventListener("DOMContentLoaded", () => {
    Object.entries(COUNT_FIELDS).forEach(([key, id]) => {
      document.getElementById(id)?.addEventListener("input", (event) => {
        const parsed = root.SWAPPRMetrics.parseCount(
          event.target.value,
          root.SWAPPRMetrics.COUNT_DIGITS[key],
        );
        if (parsed.ok) setCountError(key, false);
      });
    });
  });

  app.closeAddModal = function closeAddModal(event) {
    if (!event || event.target.id === "addModal") {
      document.getElementById("addModal").classList.add("hidden");
      app.state.editingNotebookId = null;
      app.clearPortfolioForm();
    }
  };
})(window);
