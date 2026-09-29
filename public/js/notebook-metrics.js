// The counts an author enters for a notebook (MOD001) and what the card and
// Notebook Details show from them (IDX002, MOD004). Shared with the server,
// which validates the same way.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.SWAPPRMetrics = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // Longest whole number each count may have (MOD001 field lengths).
  const COUNT_DIGITS = { wordCount: 7, pageCount: 5, diagramCount: 5 };
  const WORDS_PER_MINUTE = 200;

  function hasCount(value) {
    return value !== null && value !== undefined && value !== "";
  }

  // Below 4,000 words Quick Review, below 8,000 Standard, else Comprehensive.
  function sizeLabel(words) {
    if (!hasCount(words)) return null;
    const n = Number(words);
    if (n < 4000) return "QUICK REVIEW";
    if (n < 8000) return "STANDARD";
    return "COMPREHENSIVE";
  }

  function readingMinutes(words) {
    if (!hasCount(words)) return null;
    return Math.ceil(Number(words) / WORDS_PER_MINUTE);
  }

  // Empty means "not entered" (null); otherwise a whole number of at most
  // maxDigits digits.
  function parseCount(value, maxDigits) {
    const text = String(value ?? "").trim();
    if (!text) return { ok: true, value: null };
    if (!new RegExp(`^\\d{1,${maxDigits}}$`).test(text)) return { ok: false };
    return { ok: true, value: Number(text) };
  }

  return { COUNT_DIGITS, parseCount, readingMinutes, sizeLabel };
});
