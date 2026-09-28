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

  // m/d/yyyy, the date format used by the design spec.
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

  return { parseDbDate, formatDate, formatDateTime };
});
