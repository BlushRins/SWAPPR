(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  function endpoint(path) {
    return `${app.state.API}${path}`;
  }

  async function parseJson(response) {
    // The session is gone (expired, logged out elsewhere, or the account was
    // suspended), so send the student back to log in.
    if (response.status === 401) {
      app.auth?.clearLocalUser();
      root.location.replace("login.html");
      throw new Error("Login required");
    }
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Request failed");
    }
    return data;
  }

  async function get(path) {
    const response = await fetch(endpoint(path), { credentials: "same-origin" });
    return parseJson(response);
  }

  async function send(path, method, body) {
    const response = await fetch(endpoint(path), {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    return parseJson(response);
  }

  app.api = {
    getDepartments: () => get("/departments"),
    getSubjects: (course) =>
      get(`/subjects?course=${encodeURIComponent(course || "")}`),
    getNotebooks: () => get("/portfolios"),
    getTopPortfolios: () => get("/portfolios/top"),
    getRecentPortfolios: () => get("/portfolios/recent"),
    getSwapps: (username) => get(`/swapps/${encodeURIComponent(username)}`),
    getProfile: (username) => get(`/profile/${encodeURIComponent(username)}`),
    createPortfolio: (payload) => send("/portfolios", "POST", payload),
    updatePortfolio: (id, payload) => send(`/portfolios/${id}`, "PUT", payload),
    likeNotebook: (payload) => send("/portfolios/like", "POST", payload),
    sendSwapp: (payload) => send("/swapps", "POST", payload),
    respondSwapp: (id, payload) => send(`/swapps/${id}/respond`, "PUT", payload),
    getChats: () => get("/chats"),
    getChatMessages: (chatId) => get(`/chats/${chatId}/messages`),
    sendChatMessage: (chatId, body) =>
      send(`/chats/${chatId}/messages`, "POST", { body }),
    archiveChat: (chatId) => send(`/chats/${chatId}/archive`, "POST", {}),
    submitReport: (payload) => send("/reports", "POST", payload),
  };
})(window);
