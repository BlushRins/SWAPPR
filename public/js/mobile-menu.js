(function (root) {
  function getParts() {
    return {
      menu: document.getElementById("mobileMenu"),
      overlay: document.getElementById("mobileMenuOverlay"),
      toggle: document.getElementById("mobileMenuToggle"),
    };
  }

  function setOpen(open) {
    const { menu, overlay, toggle } = getParts();
    if (!menu || !overlay || !toggle) return;
    const wasOpen = menu.classList.contains("active");

    menu.classList.toggle("active", open);
    overlay.classList.toggle("active", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle
      .querySelector("[data-mobile-menu-icon]")
      ?.setAttribute("data-lucide", open ? "x" : "menu");
    document.body.classList.toggle("mobile-menu-open", open);
    root.lucide?.createIcons();

    // While open, only the menu and its button take focus; closing it
    // returns focus to the button. Closed, the menu is inert.
    const app = root.SWAPPR;
    if (open && !wasOpen) {
      app?.openLayer?.(menu, { keep: [toggle, overlay], returnFocus: toggle });
    } else if (!open && wasOpen) {
      app?.closeLayer?.(menu);
    }
  }

  root.toggleMobileMenu = function toggleMobileMenu() {
    const { menu } = getParts();
    setOpen(!menu?.classList.contains("active"));
  };

  root.closeMobileMenu = function closeMobileMenu() {
    setOpen(false);
  };

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });

  // Wider screens hide the menu with CSS; close it so the page isn't left
  // inert behind a menu nobody can see.
  root.matchMedia?.("(min-width: 768px)").addEventListener?.("change", (event) => {
    if (event.matches) setOpen(false);
  });

  root.SWAPPR?.registerDrawer?.(getParts().menu);
})(window);
