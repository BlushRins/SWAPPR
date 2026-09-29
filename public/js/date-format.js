(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.SWAPPRDates = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // SQLite's CURRENT_TIMESTAMP is UTC written as "YYYY-MM-DD HH:MM:SS" with
  // no zone marker; without the "Z" the browser would read it as local time.
  function parseDbDate(value) {
    if (!value) return null;
    const text = String(value).trim();
    const iso = /[zZ]$|[+-]\d\d:?\d\d$/.test(text)
      ? text
      : `${text.replace(" ", "T")}Z`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // m/d/yyyy (kept for callers that want the short form).
  function formatDate(value) {
    const date = parseDbDate(value);
    if (!date) return "";
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  }

  // m/d/yyyy h:mm AM/PM
  function formatDateTime(value) {
    const date = parseDbDate(value);
    if (!date) return "";
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const period = hours < 12 ? "AM" : "PM";
    return `${formatDate(value)} ${hours % 12 || 12}:${minutes} ${period}`;
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // MMM d, yyyy (e.g. Sep 29, 2026): the design's date format (MOD004,
  // CHT001, ADM001, ADM002, ADM004).
  function formatLongDate(value) {
    const date = parseDbDate(value);
    if (!date) return "";
    return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  // MMM d, yyyy, h:mm a (e.g. Sep 29, 2026, 10:14 AM), used for a
  // request's Sent date (IDX005).
  function formatLongDateTime(value) {
    const date = parseDbDate(value);
    if (!date) return "";
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const period = hours < 12 ? "AM" : "PM";
    return `${formatLongDate(value)}, ${hours % 12 || 12}:${minutes} ${period}`;
  }

  return { parseDbDate, formatDate, formatDateTime, formatLongDate, formatLongDateTime };
});
