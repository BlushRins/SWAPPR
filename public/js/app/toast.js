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

    toast.textContent = current;
    toast.className =
      "toast fixed bottom-24 right-6 bg-purple-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm font-medium z-50 transition-all duration-300";
    toast.style.display = "block";
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(() => {
        toast.style.display = "none";
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
