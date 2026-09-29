(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  function attachStaticEventListeners() {
    app.attachThemeToggle();

    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        app.resetPagination();
        app.renderNotebooks();
      });
    }

    document
      .getElementById("backToSubjectsBtn")
      ?.addEventListener("click", () => app.clearSelectedSubject());
  }

  function exposeCompatibilityGlobals() {
    root.handleLogout = app.handleLogout;
    app.toggleMobileMenu = root.toggleMobileMenu;
    app.closeMobileMenu = root.closeMobileMenu;
    root.toggleMobileMenu = app.toggleMobileMenu;
    root.closeMobileMenu = app.closeMobileMenu;
    root.filterBy = app.filterBy;
    root.openProfilePanel = app.openProfilePanel;
    root.closeProfilePanel = app.closeProfilePanel;
    root.openEditProfileModal = app.openEditProfileModal;
    root.openNotebookDetails = app.openNotebookDetails;
    root.closeNotebookDetails = app.closeNotebookDetails;
    root.closeEditProfileModal = app.closeEditProfileModal;
    root.openAddModal = app.openAddModal;
    root.openEditNotebookModal = app.openEditNotebookModal;
    root.closeAddModal = app.closeAddModal;
    root.submitPortfolio = app.submitPortfolio;
    root.likeNotebook = app.likeNotebook;
    root.openReportModal = app.openReportModal;
    root.closeReportModal = app.closeReportModal;
    root.submitReport = app.submitReport;
    root.closeSwappRequestModal = app.closeSwappRequestModal;
    root.submitSwappRequest = app.submitSwappRequest;
    root.closeChat = app.closeChat;
    root.sendChatMessage = app.sendChatMessage;
    root.endChat = app.endChat;
  }

  // profile.html hands over to this page through sessionStorage: open the
  // New Notebook modal (+ Add Notebook), show My Subjects after a delete, and
  // the toast that goes with it.
  function applyProfileHandoffs() {
    if (sessionStorage.getItem("openAddNotebook") === "1") {
      sessionStorage.removeItem("openAddNotebook");
      app.openAddModal();
    }
    if (sessionStorage.getItem("openView") === "mine") {
      sessionStorage.removeItem("openView");
      app.filterBy("mine");
    }
    const message = sessionStorage.getItem("flashMessage");
    if (message) {
      sessionStorage.removeItem("flashMessage");
      app.showToast(message);
    }
  }

  app.init = async function init() {
    await app.loadUser();
    app.loadDepartments();
    app.loadSubjects();
    app.loadNotebooks();
    app.loadSwapps();
    app.loadSidebar();
    app.startChatNotifications();
    app.startSwappUpdates();
    attachStaticEventListeners();
    app.openEditProfileIfRequested();
    applyProfileHandoffs();
  };

  exposeCompatibilityGlobals();

  document.addEventListener("DOMContentLoaded", app.init);
})(window);
