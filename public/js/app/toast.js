(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // Toasts show one at a time, each for 3 seconds. A toast raised while
  // another is showing waits its turn instead of replacing it, so a notice
  // (e.g. a cancelled SWAPP) is never lost. At most a few wait in line.
  const SHOW_MS = 3000;
  const FADE_MS = 300;
  const MAX_WAITING = 3;
  const waiting = [];
  let current = null;

  function showNext() {
    const toast = document.getElementById("toast");
    current = waiting.shift() ?? null;
    if (!toast || current === null) {
      current = null;
      return;
    }

    // Look and placement come from .toast in styles.css (it wraps on
    // phones). The live region stays in the page; only its text and the
    // .show class change, so each message is announced.
    toast.textContent = current;
    toast.classList.add("show");

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => {
        toast.textContent = "";
        showNext();
      }, FADE_MS);
    }, SHOW_MS);
  }

  app.showToast = function showToast(message) {
    // Skip an exact repeat of what's already showing or next in line.
    if (message === current || message === waiting[waiting.length - 1]) return;
    if (waiting.length >= MAX_WAITING) waiting.shift();
    waiting.push(message);
    if (current === null) showNext();
  };
})(window);
