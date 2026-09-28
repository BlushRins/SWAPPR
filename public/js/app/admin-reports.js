// ADM002 — Review Reports (FUNC-017).
(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});
  const ui = app.adminUi;
  const el = ui.el;

  let table = null;
  let reportsById = new Map();

  function reportedLabel(report) {
    const title = report.notebookTitle || "Deleted notebook";
    return report.reportedUser ? `${title} — @${report.reportedUser}` : title;
  }

  function getTable() {
    if (table) return table;
    table = ui.createTable({
      container: document.getElementById("reportsTable"),
      pagination: document.getElementById("reportsPagination"),
      openOn: "dblclick",
      onOpen: (row) => openReport(row.id),
      // FUNC-017 REQT-002: most to least recent.
      defaultSort: { key: "dateSubmitted", dir: "desc" },
      emptyMessage: "No reports have been submitted yet.",
      searchFields: [
        "id",
        "reporter",
        "notebookTitle",
        "reportedUser",
        "complaint",
        "resolvedBy",
        (row) => ui.reasonLabel(row.reason),
        (row) => ui.statusLabel("report", row.status),
      ],
      columns: [
        { key: "id", label: "Report ID", className: "admin-col-id" },
        { key: "reporter", label: "Reporter", render: (row) => `@${row.reporter || "unknown"}` },
        {
          key: "reported",
          label: "Reported Notebook / User",
          className: "admin-col-wide",
          value: reportedLabel,
        },
        {
          key: "complaint",
          label: "Complaint",
          className: "admin-col-wide",
          render: (row) =>
            el("span", { class: "admin-clamp", title: row.complaint || "" }, row.complaint || "—"),
        },
        {
          key: "dateSubmitted",
          label: "Date Submitted",
          render: (row) => ui.formatDate(row.dateSubmitted),
        },
        {
          key: "resolvedBy",
          label: "Resolved By",
          render: (row) => (row.resolvedBy ? `@${row.resolvedBy}` : "—"),
        },
        {
          key: "status",
          label: "Status",
          render: (row) => ui.badge("report", row.status),
        },
      ],
    });
    return table;
  }

  app.loadAdminReports = async function loadAdminReports() {
    const reports = getTable();
    try {
      const data = await app.adminApi.getReports();
      reportsById = new Map(data.reports.map((report) => [report.id, report]));
      reports.setRows(data.reports);
      app.setAdminCount?.(
        "reports",
        data.reports.filter((report) => report.status === "open").length,
      );
    } catch (err) {
      reports.showMessage(err.message || "Could not load reports.");
    }
  };

  app.searchAdminReports = (query) => getTable().setQuery(query);

  const ACTIONS = {
    remove_notebook: {
      confirm: "Are you sure you want to remove this notebook?",
      done: "Successfully removed notebook.",
    },
    suspend_user: {
      confirm: "Are you sure you want to suspend this user?",
      done: "Successfully suspended user.",
    },
    disregard: {
      confirm: null,
      done: "Report disregarded. No action was taken against the user.",
    },
  };

  async function resolve(report, action, button) {
    const { confirm: question, done } = ACTIONS[action];
    if (question && !confirm(question)) return;
    await ui.runAction(button, async () => {
      await app.adminApi.resolveReport(report.id, action);
      ui.closeModal();
      app.showToast(done);
      app.refreshAdminData?.();
    });
  }

  function reportDetails(report) {
    const isOpen = report.status === "open";
    const hasNotebook = Boolean(report.notebookTitle);

    const removeButton = ui.button("Remove Notebook", {
      tone: "red",
      icon: "trash-2",
      disabled: !hasNotebook || report.notebookStatus === "removed",
      title: report.notebookStatus === "removed" ? "Notebook already removed" : null,
      onClick: () => resolve(report, "remove_notebook", removeButton),
    });
    const suspendButton = ui.button("Suspend User", {
      tone: "red",
      icon: "user-x",
      disabled: !report.reportedUser || report.reportedUserStatus === "suspended",
      title: report.reportedUserStatus === "suspended" ? "User already suspended" : null,
      onClick: () => resolve(report, "suspend_user", suspendButton),
    });
    const disregardButton = ui.button("Disregard Report", {
      tone: "neutral",
      icon: "circle-slash",
      onClick: () => resolve(report, "disregard", disregardButton),
    });

    return el(
      "div",
      { class: "admin-detail" },
      ui.details([
        ["Report ID", String(report.id)],
        ["Reporter", `@${report.reporter || "unknown"}`],
        ["Reason", ui.reasonLabel(report.reason)],
        ["Date Submitted", ui.formatDate(report.dateSubmitted)],
        ["Status", ui.badge("report", report.status)],
        ["Resolved By", report.resolvedBy ? `@${report.resolvedBy}` : "—"],
      ]),
      ui.section("Complaint", el("p", { class: "admin-report-text" }, report.complaint || "—")),
      ui.section(
        "Reported content",
        hasNotebook
          ? ui.details([
              ["Notebook", report.notebookTitle],
              ["Notebook status", ui.badge("notebook", report.notebookStatus)],
              ["Author", report.reportedUser ? `@${report.reportedUser}` : "—"],
              ["Account status", ui.badge("account", report.reportedUserStatus)],
              ["Description", report.notebookDescription || "No description."],
              ["File", ui.safeLink(report.notebookFileUrl, "Open notebook file")],
            ])
          : el("p", { class: "admin-muted" }, "The reported notebook has been deleted by its author."),
      ),
      isOpen
        ? el("div", { class: "admin-actions" }, removeButton, suspendButton, disregardButton)
        : el(
            "p",
            { class: "admin-muted admin-actions-note" },
            `Resolved by @${report.resolvedBy || "an admin"}.`,
          ),
    );
  }

  function openReport(id) {
    const report = reportsById.get(id);
    if (!report) return;
    ui.openModal(`Report #${report.id}`, reportDetails(report), { icon: "file-warning" });
  }
})(window);
