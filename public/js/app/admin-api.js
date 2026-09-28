(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  async function parseJson(response) {
    // An expired or missing admin session sends the admin back to log in.
    if (response.status === 401) {
      root.location.replace("login.html");
      throw new Error("Login required");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.message || "Request failed");
    }
    return data;
  }

  async function get(path) {
    const response = await fetch(`/api/admin${path}`, {
      credentials: "same-origin",
    });
    return parseJson(response);
  }

  async function send(path, method, body = {}) {
    const response = await fetch(`/api/admin${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    return parseJson(response);
  }

  app.adminApi = {
    getFlaggedNotebooks: () => get("/notebooks"),
    getNotebook: (id) => get(`/notebooks/${id}`),
    markNotebookSafe: (id) => send(`/notebooks/${id}/mark-safe`, "POST"),
    markNotebookUnsafe: (id) => send(`/notebooks/${id}/mark-unsafe`, "POST"),
    getReports: () => get("/reports"),
    resolveReport: (id, action) =>
      send(`/reports/${id}/resolve`, "POST", { action }),
    getUsers: () => get("/users"),
    getUser: (id) => get(`/users/${id}`),
    setTrustScore: (id, trustScore) =>
      send(`/users/${id}/trust-score`, "PATCH", { trustScore }),
    suspendUser: (id) => send(`/users/${id}/suspend`, "POST"),
    reinstateUser: (id) => send(`/users/${id}/reinstate`, "POST"),
  };
})(window);
