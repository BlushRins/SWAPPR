/**
 * Automatic content screening for notebooks (FUNC-008 REQT-004, REQT-006 to
 * REQT-008). Runs on every create and edit.
 *
 * - The File URL must be a valid http(s) link; anything else is refused
 *   ("Missing input."), not flagged.
 * - The title, description and link are matched against BLOCKED_TERMS. A hit
 *   still saves the notebook, but as under_review with an auto_screening
 *   report, so an administrator decides in Flagged Notebooks (ADM001).
 */

const FILE_URL_MAX_LENGTH = 2048;

// Whole words or phrases, lower case. Edit this list to change the policy.
const BLOCKED_TERMS = [
  // Profanity and slurs (English and Filipino)
  "fuck",
  "fucking",
  "shit",
  "bitch",
  "asshole",
  "putangina",
  "tangina",
  "gago",
  "puta",
  // Adult content
  "porn",
  "nsfw",
  "xxx",
  "nude",
  "nudes",
  "hentai",
  // Harassment
  "kill yourself",
  "kys",
  // Piracy and cheating
  "keygen",
  "crack download",
  "leaked exam",
  "exam leak",
  "answer key leak",
];

const FIELD_LABELS = {
  title: "the title",
  description: "the description",
  fileUrl: "the file link",
};

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A term only matches as a whole word or phrase: letters and digits on
// either side mean it's part of a longer word ("classic", "Scunthorpe").
const TERM_PATTERNS = BLOCKED_TERMS.map((term) => ({
  term,
  pattern: new RegExp(
    `(^|[^a-z0-9])${term.split(" ").map(escapeRegExp).join("[^a-z0-9]+")}($|[^a-z0-9])`,
  ),
}));

function isHttpUrl(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > FILE_URL_MAX_LENGTH) return false;
  try {
    const url = new URL(text);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function blockedTermsIn(text) {
  const normalised = String(text ?? "").toLowerCase();
  if (!normalised) return [];
  return TERM_PATTERNS.filter(({ pattern }) => pattern.test(normalised)).map(
    ({ term }) => term,
  );
}

function screenNotebook({ title, description, fileUrl }) {
  const hits = [];
  for (const [field, text] of Object.entries({ title, description, fileUrl })) {
    blockedTermsIn(text).forEach((term) => hits.push({ field, term }));
  }
  return { flagged: hits.length > 0, hits };
}

// The complaint stored on the automatic report (Reports.complaint, max 500).
function screeningComplaint(hits) {
  const text = hits
    .map(({ field, term }) => `Blocked term "${term}" in ${FIELD_LABELS[field] || field}.`)
    .join(" ");
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

module.exports = {
  BLOCKED_TERMS,
  FILE_URL_MAX_LENGTH,
  isHttpUrl,
  screenNotebook,
  screeningComplaint,
};
