// ADM001 — Review Flagged Notebooks (FUNC-016).
(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});
  const ui = app.adminUi;
  const el = ui.el;

  let table = null;

  function getTable() {
    if (table) return table;
    table = ui.createTable({
      container: document.getElementById("notebooksTable"),
      pagination: document.getElementById("notebooksPagination"),
      openOn: "click",
      onOpen: (row) => openNotebook(row.id),
      defaultSort: { key: "reportCount", dir: "desc" },
      emptyMessage: "No flagged notebooks right now.",
      columns: [
        { key: "id", label: "Notebook ID", className: "admin-col-id" },
        { key: "title", label: "Title", className: "admin-col-wide" },
        { key: "author", label: "Author", render: (row) => `@${row.author || "unknown"}` },
        { key: "department", label: "Department", render: (row) => row.department || "—" },
        {
          key: "createdAt",
          label: "Date Created",
          render: (row) => ui.formatDate(row.createdAt),
        },
        { key: "reportCount", label: "Report Count", className: "admin-col-num" },
        {
          key: "status",
          label: "Status",
          render: (row) => ui.badge("notebook", row.status),
        },
      ],
    });
    return table;
  }

  app.loadAdminNotebooks = async function loadAdminNotebooks() {
    const flagged = getTable();
    try {
      const data = await app.adminApi.getFlaggedNotebooks();
      flagged.setRows(data.notebooks);
      app.setAdminCount?.("notebooks", data.notebooks.length);
    } catch (err) {
      flagged.showMessage(err.message || "Could not load flagged notebooks.");
    }
  };

  function reportItem(report) {
    return el(
      "li",
      { class: "admin-report-item" },
      el(
        "div",
        { class: "admin-report-meta" },
        el("strong", {}, ui.reporterLabel(report)),
        el("span", {}, ui.reasonLabel(report.reason)),
        el("span", {}, ui.formatDate(report.dateSubmitted)),
        ui.badge("report", report.status),
      ),
      el("p", { class: "admin-report-text" }, report.complaint || "—"),
    );
  }

  async function markSafe(notebook, button) {
    await ui.runAction(button, async () => {
      await app.adminApi.markNotebookSafe(notebook.id);
      ui.closeModal();
      app.showToast("Notebook marked as safe and returned to the feed.");
      app.refreshAdminData?.();
    });
  }

  async function markUnsafe(notebook, button) {
    // FUNC-016 REQT-010 to REQT-012: "no" keeps the admin on the details.
    if (!confirm("Are you sure you want to remove this notebook?")) return;
    await ui.runAction(button, async () => {
      await app.adminApi.markNotebookUnsafe(notebook.id);
      ui.closeModal();
      app.showToast("Successfully removed notebook.");
      app.refreshAdminData?.();
    });
  }

  function notebookDetails(notebook, reports) {
    const underReview = notebook.status === "under_review";
    const safeButton = ui.button("Mark as Safe", {
      tone: "green",
      icon: "shield-check",
      disabled: !underReview,
      onClick: () => markSafe(notebook, safeButton),
    });
    const unsafeButton = ui.button("Mark as Unsafe", {
      tone: "red",
      icon: "shield-x",
      disabled: !underReview,
      onClick: () => markUnsafe(notebook, unsafeButton),
    });

    return el(
      "div",
      { class: "admin-detail" },
      el("p", { class: "admin-detail-title" }, notebook.title || "Untitled notebook"),
      ui.details([
        ["Notebook ID", String(notebook.id)],
        ["Author", `@${notebook.author || "unknown"}`],
        ["Department", notebook.department || "—"],
        ["Subject", notebook.courseCode || "—"],
        ["Date Created", ui.formatDate(notebook.createdAt)],
        ["Report Count", String(notebook.reportCount)],
        ["Status", ui.badge("notebook", notebook.status)],
        ["File", ui.safeLink(notebook.fileUrl, "Open notebook file")],
      ]),
      ui.section(
        "Description",
        el("p", { class: "admin-report-text" }, notebook.description || "No description."),
      ),
      ui.section(
        `Why it was flagged (${reports.length})`,
        reports.length
          ? el("ul", { class: "admin-report-list" }, reports.map(reportItem))
          : el("p", { class: "admin-muted" }, "No reports on record."),
      ),
      el(
        "div",
        { class: "admin-actions" },
        underReview
          ? null
          : el("p", { class: "admin-muted" }, "This notebook is no longer under review."),
        safeButton,
        unsafeButton,
      ),
    );
  }

  async function openNotebook(id) {
    ui.openModal("Flagged Notebook", ui.loading(), { icon: "flag" });
    try {
      const data = await app.adminApi.getNotebook(id);
      ui.openModal("Flagged Notebook", notebookDetails(data.notebook, data.reports), {
        icon: "flag",
      });
    } catch (err) {
      ui.openModal(
        "Flagged Notebook",
        el("p", { class: "admin-muted" }, err.message || "Could not load this notebook."),
        { icon: "flag" },
      );
    }
  }
})(window);
