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

// A notebook leaves the public feed for admin review once it has this many
// reports. One is enough: a flagged notebook shouldn't stay visible while it
// waits for more complaints.
const REPORT_UNDER_REVIEW_THRESHOLD = 1;

// Accounts with more warnings than this are highlighted on the admin User
// Accounts screen (FUNC-018 REQT-013). The SRS leaves the number to us.
const WARNING_HIGHLIGHT_THRESHOLD = 2;

module.exports = {
  COURSE_TO_DEPARTMENT,
  REPORT_UNDER_REVIEW_THRESHOLD,
  WARNING_HIGHLIGHT_THRESHOLD,
};
