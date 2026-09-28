(function (root) {
  const KEY = "currentUser";
  let cachedUser = null;

  function parseUser(raw) {
    if (!raw || raw === "undefined" || raw === "null") return null;
    try {
      const user = JSON.parse(raw);
      return user && user.username ? user : null;
    } catch {
      return null;
    }
  }

  const auth = {
    async getUser() {
      if (cachedUser) return cachedUser;

      const response = await fetch("/api/me", { credentials: "same-origin" });
      if (!response.ok) {
        this.clearLocalUser();
        return null;
      }

      const data = await response.json();
      // Keep the role with the user so pages can tell students and admins apart.
      const user = data.success && data.user ? { ...data.user, role: data.role } : null;

      if (user) {
        this.setUser(user);
        return user;
      }

      this.clearLocalUser();
      return null;
    },

    setUser(user) {
      cachedUser = parseUser(JSON.stringify(user));
      const serialized = JSON.stringify(user);
      localStorage.setItem(KEY, serialized);
      sessionStorage.setItem(KEY, serialized);
    },

    clearLocalUser() {
      cachedUser = null;
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY);
    },

    async clearUser() {
      this.clearLocalUser();
      await fetch("/api/logout", {
        method: "POST",
        credentials: "same-origin",
      }).catch(() => {});
    },
  };

  root.SWAPPR = root.SWAPPR || {};
  root.SWAPPR.auth = auth;
})(window);
