(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // FUNC-004 REQT-010: each quick link opens Notebook Details (MOD004).
  function quickLink(notebook) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "sidebar-quicklink";
    link.textContent = notebook.title;
    link.addEventListener("click", () => app.openNotebookDetails(notebook.id));
    return link;
  }

  app.loadSidebar = async function loadSidebar() {
    await app.loadTop();
    await app.loadRecent();
  };

  app.loadTop = async function loadTop() {
    try {
      const data = await app.api.getTopPortfolios();
      const container = document.getElementById("sidebarTop");
      if (!container) return;

      container.innerHTML = "";
      data.portfolios?.forEach((notebook) => {
        container.appendChild(
          quickLink(notebook),
        );
      });
    } catch {}
  };

  app.loadRecent = async function loadRecent() {
    try {
      const data = await app.api.getRecentPortfolios();
      const container = document.getElementById("sidebarRecent");
      if (!container) return;

      container.innerHTML = "";
      data.portfolios?.forEach((notebook) => {
        container.appendChild(
          quickLink(notebook),
        );
      });
    } catch {}
  };
})(window);
