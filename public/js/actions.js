(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // Bind an explicit allowlist of page actions in script under the CSP.
  app.bindClicks = function bindClicks(actions) {
    document.querySelectorAll("[data-action]").forEach((element) => {
      const name = element.dataset.action;
      if (Object.hasOwn(actions, name)) {
        element.addEventListener("click", actions[name]);
      }
    });
  };
})(window);
