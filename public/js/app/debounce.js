(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // Search boxes filter "as the student types" (IDX001, MOD002, ADM002,
  // ADM003). Waiting until typing pauses for a moment re-draws the list once
  // instead of on every keystroke, so it doesn't flicker.
  app.SEARCH_DELAY_MS = 200;

  app.debounce = function debounce(fn, delay = app.SEARCH_DELAY_MS) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  };
})(window);
