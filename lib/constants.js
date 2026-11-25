/**
 * Shared constants for the SWAPPR application.
 */

const { courseMap } = require("./course_mapper");
const { PASSWORD_MIN_LENGTH } = require("../public/js/password-policy");

const COURSE_TO_DEPARTMENT = Object.fromEntries(
  Object.entries(courseMap).map(([course, details]) => [
    course,
    details.department,
  ]),
);

// A chat workspace closes this many days after it opens (FUNC-013 REQT-005).
const CHAT_RETENTION_DAYS = 14;

// Unique open reports required to hide a notebook. Automated screening
// still sends flagged content to moderation immediately.
const REPORT_UNDER_REVIEW_THRESHOLD = 3;

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
