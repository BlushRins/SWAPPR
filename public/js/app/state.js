(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  app.state = {
    API: "/api",
    currentUser: null,
    currentFilter: "all",
    notebooks: [],
    swapps: [],
    editingNotebookId: null,
    selectedDepartment: null,
    selectedSubject: null, // course_code currently drilled into via View notebooks
    selectedProgram: null, // degree program currently open
    currentPage: 1,
    itemsPerPage: 5,
    departments: [],
    subjects: [],
    titles: {
      all: "Browse subjects",
      mine: "My Subjects",
      matched: "My swaps",
      requests: "Requests",
      top: "Top Departments",
      recent: "Recently Added",
    },
  };
})(window);
