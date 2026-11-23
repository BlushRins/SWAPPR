(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  function updateThemeIcon(themeToggle) {
    if (!themeToggle) return;

    const isDark = document.documentElement.classList.contains("dark");
    const nextIcon = isDark ? "sun" : "moon";
    themeToggle.innerHTML = `<i data-lucide="${nextIcon}" class="w-5 h-5" aria-hidden="true"></i>`;
    const label = isDark ? "Switch to light theme" : "Switch to dark theme";
    themeToggle.setAttribute("aria-label", label);
    themeToggle.title = label;
    root.lucide?.createIcons();
  }

  app.attachThemeToggle = function attachThemeToggle() {
    const themeToggle = document.getElementById("themeToggle");
    if (!themeToggle) return;

    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark") {
      document.documentElement.classList.add("dark");
    }

    updateThemeIcon(themeToggle);

    themeToggle.addEventListener("click", () => {
      document.documentElement.classList.toggle("dark");
      const isDark = document.documentElement.classList.contains("dark");
      localStorage.setItem("theme", isDark ? "dark" : "light");
      updateThemeIcon(themeToggle);
    });
  };
})(window);
