/**
 * Shared constants for the SWAPPR application.
 */

const { courseMap } = require("./course_mapper");

const COURSE_TO_DEPARTMENT = Object.fromEntries(
  Object.entries(courseMap).map(([course, details]) => [
    course,
    details.department,
  ]),
);

// A chat workspace closes this many days after it opens (FUNC-013 REQT-005).
const CHAT_RETENTION_DAYS = 14;

// Same minimum the registration form enforces.
const PASSWORD_MIN_LENGTH = 4;

// A notebook leaves the public feed for admin review once it has this many
// reports. One is enough: a flagged notebook shouldn't stay visible while it
// waits for more complaints.
const REPORT_UNDER_REVIEW_THRESHOLD = 1;

// Accounts with more warnings than this are highlighted on the admin User
// Accounts screen (FUNC-018 REQT-013). The SRS leaves the number to us.
const WARNING_HIGHLIGHT_THRESHOLD = 2;

module.exports = {
  CHAT_RETENTION_DAYS,
  COURSE_TO_DEPARTMENT,
  PASSWORD_MIN_LENGTH,
  REPORT_UNDER_REVIEW_THRESHOLD,
  WARNING_HIGHLIGHT_THRESHOLD,
};
