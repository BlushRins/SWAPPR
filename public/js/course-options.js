// Degree programs a student can pick, grouped by school. Registration
// (login.html) and Edit Profile (index.html) both build their Course dropdown
// from this list, and the server checks submitted courses against it, so a
// student can always re-select the exact course they registered with
// (FUNC-014 REQT-005).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.SWAPPRCourses = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const COURSE_GROUPS = [
    {
      school: "School of Architecture, Fine Arts, and Design",
      courses: [
        "Bachelor of Science in Architecture",
        "Bachelor of Landscape Architecture",
        "Bachelor of Science in Interior Design",
        "Bachelor of Fine Arts major in Advertising Arts",
        "Bachelor of Fine Arts major in Cinema",
      ],
    },
    {
      school: "School of Arts and Sciences",
      courses: [
        "Bachelor of Arts in Anthropology",
        "Bachelor of Science in Biology",
        "Bachelor of Science in Marine Biology",
        "Bachelor of Science in Chemistry",
        "Bachelor of Arts in English Language Studies",
        "Bachelor of Arts in Literary and Cultural Studies with Creative Writing",
        "Bachelor of Arts in Communication major in Media",
        "Bachelor of Science in Computer Science",
        "Bachelor of Science in Information Systems",
        "Bachelor of Science in Information Technology",
        "Bachelor of Science in Data Science",
        "Bachelor of Philosophy",
        "Bachelor of Science in Applied Physics",
        "Bachelor of Science in Psychology",
      ],
    },
    {
      school: "School of Business and Economics",
      courses: [
        "Bachelor of Science in Business Administration major in Financial Management",
        "Bachelor of Science in Business Administration major in Human Resource Management",
        "Bachelor of Science in Business Administration major in Marketing Management",
        "Bachelor of Science in Business Administration major in Operations Management",
        "Bachelor of Science in Management Accounting",
        "Bachelor of Science in Internal Auditing",
        "Bachelor of Science in Entrepreneurship",
        "Bachelor of Science in Economics",
        "Bachelor of Science in Hospitality Management",
        "Bachelor of Science in Tourism Management",
        "Diploma in Culinary Arts",
      ],
    },
    {
      school: "School of Education",
      courses: [
        "Bachelor of Secondary Education major in Science",
        "Bachelor of Secondary Education major in Mathematics",
        "Bachelor of Special Needs Education specialization in Early Childhood Education-Montessori Education",
      ],
    },
    {
      school: "School of Engineering",
      courses: [
        "Bachelor of Science in Chemical Engineering",
        "Bachelor of Science in Civil Engineering",
        "Bachelor of Science in Computer Engineering",
        "Bachelor of Science in Electrical Engineering",
        "Bachelor of Science in Electronics Engineering",
        "Bachelor of Science in Industrial Engineering",
        "Bachelor of Science in Mechanical Engineering",
      ],
    },
    {
      school: "School of Health Care Professions",
      courses: [
        "Bachelor of Science in Nursing",
        "Bachelor of Science in Nutrition and Dietetics",
        "Bachelor of Science in Pharmacy",
      ],
    },
    {
      school: "School of Law and Governance",
      courses: [
        "Bachelor of Arts in Political Science major in International Relations and Foreign Service",
        "Bachelor of Arts in Political Science major in Law and Policy Studies",
      ],
    },
  ];

  function isCourse(name) {
    return COURSE_GROUPS.some((group) => group.courses.includes(name));
  }

  // Appends one <optgroup> per school. The select keeps its own placeholder.
  function fillCourseSelect(select) {
    const doc = select.ownerDocument;
    COURSE_GROUPS.forEach(({ school, courses }) => {
      const group = doc.createElement("optgroup");
      group.label = school;
      courses.forEach((course) => {
        const option = doc.createElement("option");
        option.value = course;
        option.textContent = course;
        group.appendChild(option);
      });
      select.appendChild(group);
    });
  }

  return { COURSE_GROUPS, fillCourseSelect, isCourse };
});
