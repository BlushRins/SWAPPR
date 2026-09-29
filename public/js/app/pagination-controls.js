(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // On desktop the feed list scrolls on its own, so a new view, search or
  // page starts at the top instead of keeping the last list's position.
  function scrollFeedToTop() {
    const grid = document.getElementById("notebookGrid");
    if (grid) grid.scrollTop = 0;
  }

  app.resetPagination = function resetPagination() {
    app.state.currentPage = 1;
    scrollFeedToTop();
  };

  app.getPaginatedItems = function getPaginatedItems(items) {
    const totalPages = Math.max(
      1,
      Math.ceil(items.length / app.state.itemsPerPage),
    );
    if (app.state.currentPage > totalPages) app.state.currentPage = totalPages;

    const start = (app.state.currentPage - 1) * app.state.itemsPerPage;
    return items.slice(start, start + app.state.itemsPerPage);
  };

  app.changePage = function changePage(page) {
    app.state.currentPage = page;
    app.renderNotebooks();
    scrollFeedToTop();
    document
      .getElementById("sectionTitle")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  app.renderPagination = function renderPagination(totalItems) {
    const pagination = document.getElementById("paginationControls");
    if (!pagination) return;

    const totalPages = Math.ceil(totalItems / app.state.itemsPerPage);
    if (totalPages <= 1) {
      pagination.innerHTML = "";
      pagination.classList.add("hidden");
      return;
    }

    pagination.classList.remove("hidden");

    const pageButtons = root.SWAPPRPagination.paginationItems(
      app.state.currentPage,
      totalPages,
    )
      .map((item) => {
        if (item === "ellipsis") {
          return `<span class="pagination-ellipsis" aria-hidden="true">...</span>`;
        }

        const page = item;
        return `
          <button
            type="button"
            class="pagination-page ${page === app.state.currentPage ? "active" : ""}"
            data-page="${page}"
            aria-label="Go to page ${page}"
            ${page === app.state.currentPage ? 'aria-current="page"' : ""}
          >
            ${page}
          </button>
        `;
      })
      .join("");

    pagination.innerHTML = `
      <div class="pagination-summary">
        Page ${app.state.currentPage} of ${totalPages}
      </div>
      <div class="pagination-actions">
        <button
          type="button"
          class="pagination-btn"
          data-page="${app.state.currentPage - 1}"
          ${app.state.currentPage === 1 ? "disabled" : ""}
        >
          Previous
        </button>
        <div class="pagination-pages">${pageButtons}</div>
        <button
          type="button"
          class="pagination-btn"
          data-page="${app.state.currentPage + 1}"
          ${app.state.currentPage === totalPages ? "disabled" : ""}
        >
          Next
        </button>
      </div>
    `;

    pagination.querySelectorAll("[data-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const page = Number(button.dataset.page);
        if (!button.disabled && page >= 1 && page <= totalPages) {
          app.changePage(page);
        }
      });
    });
  };
})(window);
