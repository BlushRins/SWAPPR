(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});
  const ui = app.adminUi;

  const VIEWS = {
    notebooks: {
      title: "Flagged Notebooks",
      subtitle: () =>
        `Notebooks under review after being reported. ${ui.openVerb("click")} one to review it.`,
      load: () => app.loadAdminNotebooks(),
    },
    reports: {
      title: "Reports",
      subtitle: () =>
        `Every report students have filed, newest first. ${ui.openVerb("dblclick")} one to resolve it.`,
      load: () => app.loadAdminReports(),
    },
    users: {
      title: "User Accounts",
      subtitle: () =>
        `All registered students. ${ui.openVerb("dblclick")} one to view and manage the account.`,
      load: () => app.loadAdminUsers(),
    },
  };

  let currentView = "notebooks";

  app.showAdminView = function showAdminView(view) {
    if (!VIEWS[view]) view = "notebooks";
    currentView = view;

    document.querySelectorAll("[data-view-panel]").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.viewPanel !== view);
    });
    document.querySelectorAll("[data-view]").forEach((link) => {
      link.classList.toggle("active", link.dataset.view === view);
    });
    document.getElementById("adminTitle").textContent = VIEWS[view].title;
    document.getElementById("adminSubtitle").textContent = VIEWS[view].subtitle();

    if (root.location.hash !== `#${view}`) {
      history.replaceState(null, "", `#${view}`);
    }
    VIEWS[view].load();
  };

  // Sidebar badges: flagged notebooks and open reports waiting on an admin.
  app.setAdminCount = function setAdminCount(view, count) {
    document.querySelectorAll(`[data-count="${view}"]`).forEach((badge) => {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.classList.toggle("hidden", !count);
    });
  };

  // After any moderation action, everything that could have changed reloads.
  app.refreshAdminData = function refreshAdminData() {
    app.loadAdminNotebooks();
    app.loadAdminReports();
    if (currentView === "users") app.loadAdminUsers();
  };

  app.adminLogout = async function adminLogout() {
    await app.auth?.clearUser();
    root.location.replace("login.html");
  };

  function attachListeners() {
    document.querySelectorAll("[data-view]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        app.showAdminView(link.dataset.view);
        root.closeMobileMenu?.();
      });
    });

    document
      .getElementById("reportsSearch")
      ?.addEventListener("input", (event) => app.searchAdminReports(event.target.value));
    document
      .getElementById("usersSearch")
      ?.addEventListener("input", (event) => app.searchAdminUsers(event.target.value));

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!document.getElementById("adminModal").classList.contains("hidden")) {
        ui.closeModal();
      } else if (ui.isPanelOpen()) {
        app.closeAdminUserPanel();
      }
    });

    root.addEventListener("hashchange", () => {
      const view = root.location.hash.slice(1);
      if (view !== currentView) app.showAdminView(view);
    });
  }

  app.adminInit = async function adminInit() {
    let me = null;
    try {
      const response = await fetch("/api/me", { credentials: "same-origin" });
      me = response.ok ? await response.json() : null;
    } catch {
      me = null;
    }
    if (!me?.success || me.role !== "admin") {
      root.location.replace("login.html");
      return;
    }

    document.getElementById("adminName").textContent = me.user.name;
    app.attachThemeToggle();
    attachListeners();

    // Load the badge counts for every queue, then show the requested view.
    const initialView = root.location.hash.slice(1);
    app.showAdminView(VIEWS[initialView] ? initialView : "notebooks");
    if (currentView !== "notebooks") app.loadAdminNotebooks();
    if (currentView !== "reports") app.loadAdminReports();
  };

  root.showAdminView = app.showAdminView;
  root.adminLogout = app.adminLogout;
  root.closeAdminModal = ui.closeModal;
  root.closeAdminUserPanel = app.closeAdminUserPanel;

  document.addEventListener("DOMContentLoaded", app.adminInit);
})(window);
