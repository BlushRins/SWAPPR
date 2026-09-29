// Run: node public/js/course-options.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { COURSE_GROUPS, fillCourseSelect, isCourse } = require("./course-options");
const { COURSE_TO_DEPARTMENT } = require("../../lib/constants");

const courses = COURSE_GROUPS.flatMap((group) => group.courses);

assert.strictEqual(COURSE_GROUPS.length, 7, "one group per school");
assert.strictEqual(courses.length, 45, "the 45 programs registration offers");
assert.strictEqual(new Set(courses).size, courses.length, "no course is listed twice");

// Edit Profile moves the department along with the course, so every course
// needs one.
for (const course of courses) {
  assert.ok(COURSE_TO_DEPARTMENT[course], `${course} has a department`);
}

// Every seeded student can re-select their own course (FUNC-014 REQT-005).
const seedCourses = [
  ...fs
    .readFileSync(path.join(__dirname, "../../seed.js"), "utf8")
    .matchAll(/course: "([^"]+)"/g),
].map((match) => match[1]);
assert.ok(seedCourses.length > 0, "seed.js lists student courses");
for (const course of seedCourses) {
  assert.ok(isCourse(course), `seeded course ${course} is in the list`);
}

assert.strictEqual(isCourse("Bachelor of Science in Computer Science"), true);
assert.strictEqual(isCourse("BS Computer Science"), false, "old short names are rejected");
assert.strictEqual(isCourse(""), false);
assert.strictEqual(isCourse(undefined), false);

// fillCourseSelect adds one optgroup per school after the placeholder.
function fakeElement(tag) {
  return {
    tag,
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
  };
}
const doc = { createElement: fakeElement };
const select = fakeElement("select");
select.ownerDocument = doc;
select.appendChild({ tag: "option", value: "" });
fillCourseSelect(select);

const groups = select.children.slice(1);
assert.strictEqual(select.children[0].value, "", "placeholder stays first");
assert.deepStrictEqual(
  groups.map((group) => group.label),
  COURSE_GROUPS.map((group) => group.school),
);
assert.deepStrictEqual(
  groups.flatMap((group) => group.children.map((option) => option.value)),
  courses,
);
assert.ok(
  groups.every((group) => group.children.every((option) => option.textContent === option.value)),
  "each option shows its own course name",
);

console.log("course-options.test.js OK");
