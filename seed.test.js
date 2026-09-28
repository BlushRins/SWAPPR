// Run: node seed.test.js
const assert = require("assert");
const { COURSE_TO_DEPARTMENT } = require("./lib/constants");
const { NOTEBOOKS, SWAPPS, USERS, assertKnownCourses } = require("./seed");

assert.doesNotThrow(assertKnownCourses);

for (const user of USERS) {
  assert.ok(
    COURSE_TO_DEPARTMENT[user.course],
    `${user.username} uses a canonical mapped course`,
  );
  assert.ok(
    user.course.startsWith("Bachelor ") || user.course.startsWith("Diploma "),
    `${user.username} uses a full program name`,
  );
}

for (const notebook of NOTEBOOKS) {
  assert.ok(
    COURSE_TO_DEPARTMENT[notebook.course],
    `${notebook.title} uses a canonical mapped course`,
  );
  assert.ok(
    !("department" in notebook),
    `${notebook.title} derives department from course`,
  );
}

// Each seeded SWAPP asks for one of the receiver's notebooks and offers at
// least one of the sender's (FUNC-010 REQT-003 to REQT-005).
for (const swapp of SWAPPS) {
  const label = `${swapp.from} → ${swapp.to}`;
  assert.strictEqual(
    NOTEBOOKS[swapp.requested]?.author,
    swapp.to,
    `${label} requests a notebook the receiver wrote`,
  );
  assert.ok(swapp.offered.length > 0, `${label} offers at least one notebook`);
  for (const index of swapp.offered) {
    assert.strictEqual(
      NOTEBOOKS[index]?.author,
      swapp.from,
      `${label} only offers the sender's own notebooks`,
    );
  }
}

console.log("seed.test.js OK");
