(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});
  const ui = (app.adminUi = {});

  // Builds DOM nodes. Strings become text nodes, so user-supplied values
  // (titles, complaints, usernames) are never parsed as HTML.
  ui.el = function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : String(child));
    }
    return node;
  };
  const el = ui.el;

  ui.icon = (name, className = "w-4 h-4") =>
    el("i", { "data-lucide": name, class: className });

  ui.refreshIcons = () => root.lucide?.createIcons();

  // Double-tap is unreliable on phones (it zooms), so touch screens open rows
  // with a single tap instead of the spec's double-click.
  ui.isTouch = () => root.matchMedia?.("(pointer: coarse)").matches ?? false;
  ui.openVerb = (openOn) =>
    openOn === "dblclick" && !ui.isTouch() ? "Double-click" : ui.isTouch() ? "Tap" : "Click";

  // The design spec displays dates as MMM d, yyyy (see js/date-format.js).
  ui.formatDate = (value) => root.SWAPPRDates.formatLongDate(value) || "—";

  const REASONS = {
    inappropriate: "Inappropriate or offensive content",
    spam: "Spam or misleading",
    plagiarism: "Plagiarized / not original work",
    harassment: "Harassment or abuse",
    other: "Other",
    auto_screening: "Automatic screening",
  };
  ui.reasonLabel = (reason) => REASONS[reason] || reason || "—";

  // Automatic screening files reports with no reporter (FUNC-008 REQT-008).
  ui.reporterLabel = (report) =>
    report.reporter ? `@${report.reporter}` : "Automatic screening";

  const STATUSES = {
    notebook: {
      active: ["Active", "green"],
      under_review: ["Under Review", "amber"],
      removed: ["Removed", "red"],
    },
    report: {
      open: ["Open", "amber"],
      notebook_removed: ["Notebook removed", "red"],
      user_suspended: ["User suspended", "red"],
      disregarded: ["Disregarded", "gray"],
    },
    account: {
      active: ["Active", "green"],
      suspended: ["Suspended", "red"],
    },
  };
  ui.statusLabel = (kind, value) => STATUSES[kind]?.[value]?.[0] || value || "—";
  ui.badge = function badge(kind, value) {
    const [label, tone] = STATUSES[kind]?.[value] || [value || "—", "gray"];
    return el("span", { class: `admin-badge admin-badge--${tone}`, text: label });
  };

  // Only http(s) links are rendered, so a stored "javascript:" URL can't run.
  ui.safeLink = function safeLink(url, text) {
    if (!/^https?:\/\//i.test(String(url || ""))) {
      return el("span", { class: "admin-muted", text: "No file link" });
    }
    return el(
      "a",
      {
        href: url,
        target: "_blank",
        rel: "noopener noreferrer",
        class: "admin-link",
      },
      text || url,
    );
  };

  ui.button = function button(label, { tone = "neutral", icon, onClick, disabled, title } = {}) {
    return el(
      "button",
      {
        type: "button",
        class: `admin-btn admin-btn--${tone}`,
        onClick,
        disabled,
        title,
      },
      icon ? ui.icon(icon) : null,
      label,
    );
  };

  // Runs an action with its button disabled, so a double click can't send it
  // twice. Errors are shown as a toast.
  ui.runAction = async function runAction(buttonNode, action) {
    if (buttonNode) buttonNode.disabled = true;
    try {
      await action();
    } catch (err) {
      app.showToast(err.message || "Something went wrong. Please try again.");
    } finally {
      if (buttonNode && buttonNode.isConnected) buttonNode.disabled = false;
    }
  };

  // ── Sortable, searchable, paginated table ───────────────────────────────
  // columns: [{ key, label, value?(row), render?(row), sortable?, className? }]
  ui.createTable = function createTable({
    container,
    pagination,
    columns,
    defaultSort,
    searchFields = [],
    pageSize = 10,
    emptyMessage,
    openOn = "dblclick",
    onOpen,
    rowClass,
  }) {
    let rows = [];
    let query = "";
    let sort = { ...defaultSort };
    let page = 1;

    const valueOf = (column, row) =>
      column.value ? column.value(row) : row[column.key];

    function compare(a, b) {
      const column = columns.find((item) => item.key === sort.key);
      if (!column) return 0;
      const left = valueOf(column, a);
      const right = valueOf(column, b);
      let result;
      if (typeof left === "number" && typeof right === "number") {
        result = left - right;
      } else {
        result = String(left ?? "").localeCompare(String(right ?? ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }
      return sort.dir === "asc" ? result : -result;
    }

    function visibleRows() {
      const needle = query.trim().toLowerCase();
      const matches = needle
        ? rows.filter((row) =>
            searchFields.some((field) => {
              const value = typeof field === "function" ? field(row) : row[field];
              return String(value ?? "").toLowerCase().includes(needle);
            }),
          )
        : rows.slice();
      return matches.sort(compare);
    }

    function header() {
      return el(
        "tr",
        {},
        columns.map((column) => {
          if (column.sortable === false) {
            return el("th", { scope: "col", class: column.className }, column.label);
          }
          const active = sort.key === column.key;
          const direction = active ? sort.dir : null;
          return el(
            "th",
            {
              scope: "col",
              class: column.className,
              "aria-sort": direction
                ? direction === "asc"
                  ? "ascending"
                  : "descending"
                : "none",
            },
            el(
              "button",
              {
                type: "button",
                class: `admin-sort${active ? " active" : ""}`,
                title: `Sort by ${column.label}`,
                onClick: () => {
                  sort = {
                    key: column.key,
                    dir: active && sort.dir === "asc" ? "desc" : "asc",
                  };
                  page = 1;
                  render();
                },
              },
              column.label,
              el("span", {
                class: "admin-sort-arrow",
                "aria-hidden": "true",
                text: direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕",
              }),
            ),
          );
        }),
      );
    }

    function bodyRow(row) {
      const open = () => onOpen?.(row);
      const extraClass = rowClass?.(row);
      const openEvent = openOn === "dblclick" && !ui.isTouch() ? "onDblclick" : "onClick";
      return el(
        "tr",
        {
          class: `admin-row${extraClass ? ` ${extraClass}` : ""}`,
          tabindex: "0",
          title: `${ui.openVerb(openOn)} to view`,
          [openEvent]: (event) => {
            if (event.target.closest("button, a")) return;
            open();
          },
          onKeydown: (event) => {
            if (event.key === "Enter" && event.target === event.currentTarget) open();
          },
        },
        columns.map((column) => {
          const content = column.render ? column.render(row) : valueOf(column, row);
          return el("td", { class: column.className }, content ?? "—");
        }),
      );
    }

    function renderPagination(totalItems) {
      if (!pagination) return;
      const totalPages = Math.ceil(totalItems / pageSize);
      pagination.replaceChildren();
      pagination.classList.toggle("hidden", totalPages <= 1);
      if (totalPages <= 1) return;

      const goTo = (target) => {
        page = target;
        render();
      };
      const pageButtons = root.SWAPPRPagination.paginationItems(page, totalPages).map(
        (item) =>
          item === "ellipsis"
            ? el("span", { class: "pagination-ellipsis", "aria-hidden": "true" }, "...")
            : el(
                "button",
                {
                  type: "button",
                  class: `pagination-page${item === page ? " active" : ""}`,
                  "aria-label": `Go to page ${item}`,
                  "aria-current": item === page ? "page" : null,
                  onClick: () => goTo(item),
                },
                String(item),
              ),
      );

      pagination.append(
        el("div", { class: "pagination-summary" }, `Page ${page} of ${totalPages}`),
        el(
          "div",
          { class: "pagination-actions" },
          el(
            "button",
            {
              type: "button",
              class: "pagination-btn",
              disabled: page === 1,
              onClick: () => goTo(page - 1),
            },
            "Previous",
          ),
          el("div", { class: "pagination-pages" }, pageButtons),
          el(
            "button",
            {
              type: "button",
              class: "pagination-btn",
              disabled: page === totalPages,
              onClick: () => goTo(page + 1),
            },
            "Next",
          ),
        ),
      );
    }

    function render() {
      const matches = visibleRows();
      const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
      page = Math.min(page, totalPages);
      const pageRows = matches.slice((page - 1) * pageSize, page * pageSize);

      let body;
      if (pageRows.length) {
        body = pageRows.map(bodyRow);
      } else {
        const message = query.trim() ? "No Matching Records Found." : emptyMessage;
        body = el(
          "tr",
          {},
          el("td", { class: "admin-empty", colspan: String(columns.length) }, message),
        );
      }

      container.replaceChildren(
        el(
          "table",
          { class: "admin-table" },
          el("thead", {}, header()),
          el("tbody", {}, body),
        ),
      );
      renderPagination(matches.length);
      ui.refreshIcons();
    }

    return {
      setRows(nextRows) {
        rows = nextRows || [];
        render();
      },
      setQuery(nextQuery) {
        query = nextQuery;
        page = 1;
        render();
      },
      showMessage(message) {
        container.replaceChildren(
          el("div", { class: "admin-empty admin-empty--block" }, message),
        );
        pagination?.classList.add("hidden");
      },
    };
  };

  ui.loading = (text = "Loading...") =>
    el(
      "div",
      { class: "admin-empty admin-empty--block" },
      el("span", { class: "admin-spinner", "aria-hidden": "true" }),
      text,
    );

  // ── Detail modal (shared by Flagged Notebooks and Reports) ──────────────
  ui.openModal = function openModal(title, content, { icon = "file-text" } = {}) {
    document.getElementById("adminModalTitle").replaceChildren(ui.icon(icon, "w-5 h-5"), title);
    document.getElementById("adminModalBody").replaceChildren(content);
    document.getElementById("adminModal").classList.remove("hidden");
    ui.refreshIcons();
  };

  ui.closeModal = function closeModal(event) {
    if (event && event.target.id !== "adminModal") return;
    document.getElementById("adminModal").classList.add("hidden");
    document.getElementById("adminModalBody").replaceChildren();
  };

  // ── User slide-over (View Specific User) ────────────────────────────────
  ui.openPanel = function openPanel(content) {
    document.getElementById("adminUserPanelBody").replaceChildren(content);
    document.getElementById("adminUserPanel").classList.add("open");
    document.getElementById("adminUserOverlay").classList.add("active");
    ui.refreshIcons();
  };

  ui.setPanelContent = function setPanelContent(content) {
    document.getElementById("adminUserPanelBody").replaceChildren(content);
    ui.refreshIcons();
  };

  ui.closePanel = function closePanel() {
    document.getElementById("adminUserPanel").classList.remove("open");
    document.getElementById("adminUserOverlay").classList.remove("active");
  };

  ui.isPanelOpen = () =>
    document.getElementById("adminUserPanel")?.classList.contains("open");

  // Label/value rows for detail views.
  ui.details = (pairs) =>
    el(
      "dl",
      { class: "admin-details" },
      pairs.flatMap(([label, value]) => [
        el("dt", {}, label),
        el("dd", {}, value ?? "—"),
      ]),
    );

  ui.section = (title, ...children) =>
    el("section", { class: "admin-section" }, el("h4", {}, title), ...children);
})(window);
