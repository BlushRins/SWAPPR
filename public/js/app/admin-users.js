// ADM003 — Manage User Accounts (FUNC-018).
(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});
  const ui = app.adminUi;
  const el = ui.el;

  let table = null;
  let warningThreshold = null;
  let openUserId = null;

  function warningCell(row) {
    if (!row.highlightWarning) return String(row.warningCount);
    return el(
      "span",
      {
        class: "admin-warning-count",
        title: `More than ${warningThreshold} warnings`,
      },
      ui.icon("triangle-alert", "w-3.5 h-3.5"),
      String(row.warningCount),
    );
  }

  function getTable() {
    if (table) return table;
    table = ui.createTable({
      container: document.getElementById("usersTable"),
      pagination: document.getElementById("usersPagination"),
      openOn: "dblclick",
      onOpen: (row) => openUser(row.id),
      defaultSort: { key: "id", dir: "asc" },
      emptyMessage: "No registered students yet.",
      rowClass: (row) => (row.highlightWarning ? "admin-row--warning" : ""),
      searchFields: [
        "id",
        "username",
        "name",
        "course",
        (row) => ui.statusLabel("account", row.accountStatus),
      ],
      columns: [
        { key: "id", label: "User ID", className: "admin-col-id" },
        { key: "username", label: "Username", render: (row) => `@${row.username}` },
        { key: "name", label: "Name", render: (row) => row.name || "—" },
        { key: "course", label: "Course", className: "admin-col-wide", render: (row) => row.course || "—" },
        {
          key: "trustScore",
          label: "Trust Score",
          className: "admin-col-num",
          render: (row) => `${row.trustScore}%`,
        },
        {
          key: "warningCount",
          label: "Warning Count",
          className: "admin-col-num",
          render: warningCell,
        },
        {
          key: "accountStatus",
          label: "Account Status",
          render: (row) => ui.badge("account", row.accountStatus),
        },
      ],
    });
    return table;
  }

  app.loadAdminUsers = async function loadAdminUsers() {
    const users = getTable();
    try {
      const data = await app.adminApi.getUsers();
      warningThreshold = data.warningThreshold;
      const note = document.getElementById("usersWarningNote");
      if (note) {
        note.textContent = `Highlighted rows have more than ${warningThreshold} warnings.`;
      }
      users.setRows(data.users);
    } catch (err) {
      users.showMessage(err.message || "Could not load user accounts.");
    }
  };

  app.searchAdminUsers = (query) => getTable().setQuery(query);

  function stat(label, value, tone) {
    return el(
      "div",
      { class: `admin-stat${tone ? ` admin-stat--${tone}` : ""}` },
      el("span", { class: "admin-stat-value" }, value),
      el("span", { class: "admin-stat-label" }, label),
    );
  }

  function trustScoreEditor(user) {
    const input = el("input", {
      type: "number",
      min: "0",
      max: "100",
      step: "1",
      value: String(user.trustScore),
      class: "input-field admin-trust-input",
      "aria-label": "Trust score",
      id: "adminTrustInput",
    });
    const error = el(
      "p",
      { class: "report-error hidden" },
      "Enter a whole number from 0 to 100.",
    );
    input.addEventListener("input", () => {
      input.classList.remove("error");
      error.classList.add("hidden");
    });

    const save = ui.button("Save", {
      tone: "purple",
      onClick: async () => {
        const value = Number(input.value);
        if (input.value.trim() === "" || !Number.isInteger(value) || value < 0 || value > 100) {
          input.classList.add("error");
          error.classList.remove("hidden");
          input.focus();
          return;
        }
        await ui.runAction(save, async () => {
          await app.adminApi.setTrustScore(user.id, value);
          app.showToast("Trust score updated.");
          await refreshOpenUser();
          app.loadAdminUsers();
        });
      },
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") save.click();
    });

    return el(
      "div",
      {},
      el(
        "label",
        { class: "field-section-label", for: "adminTrustInput" },
        "Adjust trust score (%)",
      ),
      el("div", { class: "admin-trust-row" }, input, save),
      error,
    );
  }

  function statusButton(user) {
    if (user.accountStatus === "suspended") {
      const reinstate = ui.button("Reinstate Account", {
        tone: "green",
        icon: "user-check",
        onClick: () =>
          ui.runAction(reinstate, async () => {
            await app.adminApi.reinstateUser(user.id);
            app.showToast("Account reinstated.");
            await refreshOpenUser();
            app.refreshAdminData?.();
          }),
      });
      return reinstate;
    }

    const suspend = ui.button("Suspend Account", {
      tone: "red",
      icon: "user-x",
      onClick: async () => {
        // FUNC-018 REQT-009 to REQT-011: "no" keeps the admin on this user.
        if (!confirm("Are you sure you want to suspend this user?")) return;
        await ui.runAction(suspend, async () => {
          await app.adminApi.suspendUser(user.id);
          app.showToast("Successfully suspended user.");
          await refreshOpenUser();
          app.refreshAdminData?.();
        });
      },
    });
    return suspend;
  }

  function list(items, emptyText, renderItem) {
    if (!items.length) return el("p", { class: "admin-muted" }, emptyText);
    return el("ul", { class: "admin-list" }, items.map(renderItem));
  }

  function userDetails({ user, notebooks, swapps, reports }) {
    const initials = (user.name || user.username || "?")
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    return el(
      "div",
      { class: "admin-user" },
      el(
        "div",
        { class: "admin-user-head" },
        el("div", { class: "profile-avatar" }, el("span", {}, initials)),
        el(
          "div",
          { class: "min-w-0" },
          el("p", { class: "admin-user-name" }, user.name || user.username),
          el("p", { class: "admin-muted" }, `@${user.username} · User ID ${user.id}`),
          ui.badge("account", user.accountStatus),
        ),
      ),
      el(
        "div",
        { class: "admin-stats" },
        stat("Trust score", `${user.trustScore}%`),
        stat("Warnings", String(user.warningCount), user.highlightWarning ? "red" : null),
        stat("Notebooks", String(notebooks.length)),
      ),
      user.highlightWarning
        ? el(
            "p",
            { class: "admin-alert" },
            ui.icon("triangle-alert"),
            `This account has more than ${warningThreshold} warnings.`,
          )
        : null,
      ui.details([
        ["Course", user.course || "—"],
        ["Department", user.department || "—"],
        ["Student ID", user.studentId || "—"],
        ["Email", user.email || "—"],
        ["Bio", user.bio || "—"],
      ]),
      el(
        "div",
        { class: "admin-section admin-user-controls" },
        trustScoreEditor(user),
        statusButton(user),
      ),
      ui.section(
        `Uploaded notebooks (${notebooks.length})`,
        list(notebooks, "No notebooks uploaded.", (notebook) =>
          el(
            "li",
            {},
            el("span", { class: "admin-list-main" }, notebook.title || "Untitled notebook"),
            el(
              "span",
              { class: "admin-list-side" },
              notebook.reportCount ? `${notebook.reportCount} report(s)` : null,
              ui.badge("notebook", notebook.status),
            ),
          ),
        ),
      ),
      ui.section(
        `SWAPP history (${swapps.length})`,
        list(swapps, "No SWAPP requests yet.", (swapp) =>
          el(
            "li",
            {},
            el(
              "span",
              { class: "admin-list-main" },
              swapp.direction === "sent"
                ? `Sent to @${swapp.partner || "unknown"}`
                : `Received from @${swapp.partner || "unknown"}`,
            ),
            el("span", { class: "admin-list-side admin-capitalize" }, swapp.status || "pending"),
          ),
        ),
      ),
      ui.section(
        `Reports filed against them (${reports.length})`,
        list(reports, "No reports filed against this user.", (report) =>
          el(
            "li",
            { class: "admin-list-stacked" },
            el(
              "div",
              { class: "admin-report-meta" },
              el("strong", {}, report.notebookTitle || "Notebook"),
              el("span", {}, `by @${report.reporter || "unknown"}`),
              el("span", {}, ui.formatDate(report.dateSubmitted)),
              ui.badge("report", report.status),
            ),
            el("p", { class: "admin-report-text" }, `${ui.reasonLabel(report.reason)}: ${report.complaint || "—"}`),
          ),
        ),
      ),
    );
  }

  async function refreshOpenUser() {
    if (!openUserId || !ui.isPanelOpen()) return;
    const data = await app.adminApi.getUser(openUserId);
    ui.setPanelContent(userDetails(data));
  }

  async function openUser(id) {
    openUserId = id;
    ui.openPanel(ui.loading());
    try {
      const data = await app.adminApi.getUser(id);
      if (openUserId === id) ui.setPanelContent(userDetails(data));
    } catch (err) {
      ui.setPanelContent(
        el("p", { class: "admin-muted" }, err.message || "Could not load this user."),
      );
    }
  }

  app.closeAdminUserPanel = function closeAdminUserPanel() {
    openUserId = null;
    ui.closePanel();
  };
})(window);
