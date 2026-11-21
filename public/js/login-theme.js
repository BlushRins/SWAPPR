// FUNC-005 REQT-001 / REQT-004: follow the theme chosen on the other pages.
try {
  if (localStorage.getItem("theme") === "dark") {
    document.documentElement.classList.add("dark");
  }
} catch {}
