(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // FUNC-004 REQT-010: each quick link opens Notebook Details (MOD004).
  function quickLink(notebook, colourClasses) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = `block w-full text-left text-xs transition cursor-pointer hover:underline ${colourClasses}`;
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
          quickLink(
            notebook,
            "text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-200",
          ),
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
          quickLink(notebook, "hover:text-purple-700 dark:hover:text-purple-200"),
        );
      });
    } catch {}
  };
})(window);
