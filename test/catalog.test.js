const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeCatalog } = require("../lib/catalog");
const { subjectsForCourse } = require("../lib/subjects");

const subject = (course_code, course_description, department_reserved) => ({
  course_code, course_description, department_reserved,
});

test("fills only supported departments and keeps ambiguous or graduate rows separate", () => {
  const catalog = normalizeCatalog([
    subject("CS 3106", "Security", null),
    subject("CS 3106N", "Security", "DCISM"),
    subject("CS 3101", "Databases", "Department of Computer, Information Sciences and Mathematics"),
    subject("CS 3109", "Algorithms", null),
    subject("GE-ART", "Art Appreciation", null),
    subject("EDM 1", "Mission", null),
    subject("EDM 6000", "Education", null),
    subject("AD 01", "Drawing", "Basic Education - Senior High School"),
    subject("AD 1111", "Design", "Department of Architecture"),
    subject("AD 9999", "Unknown", null),
  ]);
  const department = (code) => catalog.find((row) => row.course_code === code).department;
  assert.equal(department("CS 3106"), department("CS 3106N"));
  assert.equal(department("CS 3109"), department("CS 3101"));
  assert.equal(department("GE-ART"), "General Education & Electives");
  assert.equal(department("EDM 1"), "General Education & Electives");
  assert.equal(department("EDM 6000"), "");
  assert.equal(department("AD 9999"), "");
  const architecture = subjectsForCourse(catalog, "Bachelor of Science in Architecture");
  assert.ok(architecture.some((row) => row.code === "AD 1111"));
  assert.ok(!architecture.some((row) => row.code === "AD 01" || row.code === "EDM 6000"));
});

test("does not treat graduate science education or Fine Arts auditing entries as core", () => {
  const rows = [
    subject("SCED 1101B", "Biology", "DMSE"),
    subject("SCED 323", "Dissertation", "DMSE"),
    subject("PHSCED 7000R", "Seminar", "DMSE"),
    subject("AA 3101", "Auditing", "Department of Accountancy"),
    subject("AA 411X", "Fine Arts", "Department of Fine Arts"),
    subject("THC-EN", "Tourism and Hospitality", "DHT"),
  ];
  const codesFor = (program) => subjectsForCourse(rows, program).map(({ code }) => code);
  assert.deepEqual(codesFor("Bachelor of Secondary Education major in Science"), ["SCED 1101B"]);
  assert.deepEqual(codesFor("Bachelor of Science in Internal Auditing"), ["AA 3101"]);
  assert.deepEqual(codesFor("Bachelor of Science in Hospitality Management"), ["THC-EN"]);
  assert.deepEqual(codesFor("Bachelor of Science in Tourism Management"), ["THC-EN"]);
  assert.deepEqual(codesFor("Diploma in Culinary Arts"), []);
});
