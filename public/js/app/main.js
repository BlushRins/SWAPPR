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
    root.openAddModal = app.openAddModal;
    root.openEditNotebookModal = app.openEditNotebookModal;
    root.closeAddModal = app.closeAddModal;
    root.submitPortfolio = app.submitPortfolio;
    root.likeNotebook = app.likeNotebook;
    root.closeChat = app.closeChat;
    root.sendChatMessage = app.sendChatMessage;
    root.endChat = app.endChat;
  }

  app.init = async function init() {
    await app.loadUser();
    app.loadDepartments();
    app.loadSubjects();
    app.loadNotebooks();
    app.loadSwapps();
    app.loadSidebar();
    attachStaticEventListeners();
  };

  exposeCompatibilityGlobals();

  document.addEventListener("DOMContentLoaded", app.init);
})(window);
