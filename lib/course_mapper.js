#!/usr/bin/env node

// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSITY COURSE → DEPARTMENT MAP
// University of San Carlos (USC)
// ─────────────────────────────────────────────────────────────────────────────

const courseMap = {

  // ── School of Architecture, Fine Arts and Design ─────────────────────────

  "Bachelor of Science in Architecture": {
    school: "School of Architecture, Fine Arts and Design",
    department: "Department of Architecture",
  },
  "Bachelor of Landscape Architecture": {
    school: "School of Architecture, Fine Arts and Design",
    department: "Department of Architecture",
  },
  "Bachelor of Science in Interior Design": {
    school: "School of Architecture, Fine Arts and Design",
    department: "Department of Architecture",
  },
  "Bachelor of Fine Arts major in Advertising Arts": {
    school: "School of Architecture, Fine Arts and Design",
    department: "Department of Fine Arts",
  },
  "Bachelor of Fine Arts major in Cinema": {
    school: "School of Architecture, Fine Arts and Design",
    department: "Department of Fine Arts",
  },

  // ── School of Arts and Sciences ──────────────────────────────────────────

  "Bachelor of Arts in Anthropology": {
    school: "School of Arts and Sciences",
    department: "Department of Sociology, Anthropology and History",
  },
  "Bachelor of Science in Biology": {
    school: "School of Arts and Sciences",
    department: "Department of Biology",
  },
  "Bachelor of Science in Marine Biology": {
    school: "School of Arts and Sciences",
    department: "Department of Biology",
  },
  "Bachelor of Science in Chemistry": {
    school: "School of Arts and Sciences",
    department: "Department of Chemistry",
  },
  "Bachelor of Arts in English Language Studies": {
    school: "School of Arts and Sciences",
    department: "Department of Communications, Linguistics and Literature",
  },
  "Bachelor of Arts in Literary and Cultural Studies with Creative Writing": {
    school: "School of Arts and Sciences",
    department: "Department of Communications, Linguistics and Literature",
  },
  "Bachelor of Arts in Communication major in Media": {
    school: "School of Arts and Sciences",
    department: "Department of Communications, Linguistics and Literature",
  },
  "Bachelor of Science in Computer Science": {
    school: "School of Arts and Sciences",
    department: "Department of Computer, Information Sciences and Mathematics",
  },
  "Bachelor of Science in Information Systems": {
    school: "School of Arts and Sciences",
    department: "Department of Computer, Information Sciences and Mathematics",
  },
  "Bachelor of Science in Information Technology": {
    school: "School of Arts and Sciences",
    department: "Department of Computer, Information Sciences and Mathematics",
  },
  "Bachelor of Science in Data Science": {
    school: "School of Arts and Sciences",
    department: "Department of Computer, Information Sciences and Mathematics",
  },
  "Bachelor of Philosophy": {
    school: "School of Arts and Sciences",
    department: "Department of Philosophy",
  },
  "Bachelor of Science in Applied Physics": {
    school: "School of Arts and Sciences",
    department: "Department of Physics",
  },
  "Bachelor of Science in Psychology": {
    school: "School of Arts and Sciences",
    department: "Department of Psychology",
  },

  // ── School of Health Care Professions ────────────────────────────────────

  "Bachelor of Science in Nursing": {
    school: "School of Health Care Professions",
    department: "Department of Nursing",
  },
  "Bachelor of Science in Nutrition and Dietetics": {
    school: "School of Health Care Professions",
    department: "Department of Nutrition and Dietetics",
  },
  "Bachelor of Science in Pharmacy": {
    school: "School of Health Care Professions",
    department: "Department of Pharmacy",
  },

  // ── School of Business and Economics ─────────────────────────────────────

  "Bachelor of Science in Accountancy": {
    school: "School of Business and Economics",
    department: "Department of Accountancy",
  },
  "Bachelor of Science in Management Accounting": {
    school: "School of Business and Economics",
    department: "Department of Accountancy",
  },
  "Bachelor of Science in Internal Auditing": {
    school: "School of Business and Economics",
    department: "Department of Accountancy",
  },
  "Bachelor of Science in Business Administration major in Financial Management": {
    school: "School of Business and Economics",
    department: "Department of Business Administration",
  },
  "Bachelor of Science in Business Administration major in Human Resource Management": {
    school: "School of Business and Economics",
    department: "Department of Business Administration",
  },
  "Bachelor of Science in Business Administration major in Marketing Management": {
    school: "School of Business and Economics",
    department: "Department of Business Administration",
  },
  "Bachelor of Science in Business Administration major in Operations Management": {
    school: "School of Business and Economics",
    department: "Department of Business Administration",
  },
  "Bachelor of Science in Entrepreneurship": {
    school: "School of Business and Economics",
    department: "Department of Business Administration",
  },
  "Bachelor of Science in Economics": {
    school: "School of Business and Economics",
    department: "Department of Economics",
  },
  "Bachelor of Science in Hospitality Management": {
    school: "School of Business and Economics",
    department: "Department of Hospitality and Tourism",
  },
  "Bachelor of Science in Tourism Management": {
    school: "School of Business and Economics",
    department: "Department of Hospitality and Tourism",
  },
  "Diploma in Culinary Arts": {
    school: "School of Business and Economics",
    department: "Department of Hospitality and Tourism",
  },

  // ── School of Education ───────────────────────────────────────────────────

  "Bachelor of Secondary Education major in Science": {
    school: "School of Education",
    department: "Department of Teacher Education",
  },
  "Bachelor of Secondary Education major in Mathematics": {
    school: "School of Education",
    department: "Department of Teacher Education",
  },
  "Bachelor of Special Needs Education specialization in Early Childhood Education-Montessori Education": {
    school: "School of Education",
    department: "Department of Teacher Education",
  },

  // ── School of Engineering ─────────────────────────────────────────────────

  "Bachelor of Science in Chemical Engineering": {
    school: "School of Engineering",
    department: "Department of Chemical Engineering",
  },
  "Bachelor of Science in Civil Engineering": {
    school: "School of Engineering",
    department: "Department of Civil Engineering",
  },
  "Bachelor of Science in Computer Engineering": {
    school: "School of Engineering",
    department: "Department of Computer Engineering",
  },
  "Bachelor of Science in Electrical Engineering": {
    school: "School of Engineering",
    department: "Department of Electrical & Electronics Engineering",
  },
  "Bachelor of Science in Electronics Engineering": {
    school: "School of Engineering",
    department: "Department of Electrical & Electronics Engineering",
  },
  "Bachelor of Science in Industrial Engineering": {
    school: "School of Engineering",
    department: "Department of Industrial Engineering",
  },
  "Bachelor of Science in Mechanical Engineering": {
    school: "School of Engineering",
    department: "Department of Mechanical and Manufacturing Engineering",
  },

  // ── School of Law and Governance ─────────────────────────────────────────

  "Bachelor of Arts in Political Science major in International Relations and Foreign Service": {
    school: "School of Law and Governance",
    department: "Department of Political Science",
  },
  "Bachelor of Arts in Political Science major in Law and Policy Studies": {
    school: "School of Law and Governance",
    department: "Department of Political Science",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// SUBJECT CODE-PREFIX MAP
// A subject's course_code prefix marks which program(s) it belongs to.
//   - PROGRAM_PREFIXES[program]              → that program's OWN prefixes
//   - DEPARTMENT_SHARED_PREFIXES[department] → prefixes taken by ALL programs
//                                              in that department (shared core)
// Runtime filtering uses ONLY these prefixes; department-name strings are not
// consulted at request time. Entries marked `// REVIEW:` are uncertain
// author assignments awaiting human confirmation — keep them as-is.
// ─────────────────────────────────────────────────────────────────────────────

const PROGRAM_PREFIXES = {
  // ── Architecture ──
  "Bachelor of Science in Architecture": ["AR"],
  "Bachelor of Landscape Architecture": ["LA"],
  "Bachelor of Science in Interior Design": ["IN"],

  // ── Fine Arts ──
  "Bachelor of Fine Arts major in Advertising Arts": ["ADV"],
  "Bachelor of Fine Arts major in Cinema": ["CNM"],

  // ── Sociology, Anthropology and History ──
  "Bachelor of Arts in Anthropology": ["ANTH"],

  // ── Biology ──
  "Bachelor of Science in Biology": ["BIO"],
  "Bachelor of Science in Marine Biology": ["MBIO"],

  // ── Chemistry ──
  "Bachelor of Science in Chemistry": ["CHEM"],

  // ── Communications, Linguistics and Literature ──
  "Bachelor of Arts in English Language Studies": ["ELS"],
  "Bachelor of Arts in Literary and Cultural Studies with Creative Writing": ["LIT"],
  "Bachelor of Arts in Communication major in Media": ["COMM"],

  // ── Computer, Information Sciences and Mathematics ──
  "Bachelor of Science in Computer Science": ["CS"],
  "Bachelor of Science in Information Systems": ["IS"],
  "Bachelor of Science in Information Technology": ["IT"],
  "Bachelor of Science in Data Science": [], // CONFIRMED: courses.db has no Data Science prefix (DS subjects sit under CS/grad codes); relies on shared CIS only until scraper adds them

  // ── Philosophy ──
  "Bachelor of Philosophy": ["PHIL"],

  // ── Physics ──
  "Bachelor of Science in Applied Physics": ["PHYS", "PHYSEL"],

  // ── Psychology ──
  "Bachelor of Science in Psychology": ["PSY", "PSYC"],

  // ── Nursing ──
  "Bachelor of Science in Nursing": ["NCM"],

  // ── Nutrition and Dietetics ──
  "Bachelor of Science in Nutrition and Dietetics": ["ND"],

  // ── Pharmacy ──
  "Bachelor of Science in Pharmacy": ["PHARM", "PHSC", "PHCH"],

  // ── Accountancy ──
  "Bachelor of Science in Accountancy": [], // REVIEW: shares the AC core only (see DEPARTMENT_SHARED_PREFIXES)
  "Bachelor of Science in Management Accounting": ["AAE"], // REVIEW
  "Bachelor of Science in Internal Auditing": ["AA"], // REVIEW

  // ── Business Administration ──
  "Bachelor of Science in Business Administration major in Financial Management": ["BFM"],
  "Bachelor of Science in Business Administration major in Human Resource Management": ["BHR"],
  "Bachelor of Science in Business Administration major in Marketing Management": ["BMM"],
  "Bachelor of Science in Business Administration major in Operations Management": ["BOM"],
  "Bachelor of Science in Entrepreneurship": ["BEN"],

  // ── Economics ──
  "Bachelor of Science in Economics": ["ECN"],

  // ── Hospitality and Tourism ──
  "Bachelor of Science in Hospitality Management": ["HM", "HPC", "THC"],
  "Bachelor of Science in Tourism Management": ["TM", "TPC", "THC"],
  "Diploma in Culinary Arts": ["HPC"], // REVIEW: culinary draws on hospitality core HPC

  // ── Teacher Education ──
  "Bachelor of Secondary Education major in Science": ["SCED"], // REVIEW: SCED prefix lives under Science & Math Education dept
  "Bachelor of Secondary Education major in Mathematics": ["MATHED"], // REVIEW: cross-department prefix
  "Bachelor of Special Needs Education specialization in Early Childhood Education-Montessori Education": ["SNED", "ECED", "EDSP"], // REVIEW

  // ── Engineering ──
  "Bachelor of Science in Chemical Engineering": ["CHE", "CHEA", "CHEL"],
  "Bachelor of Science in Civil Engineering": ["CE", "CEE", "CES", "CEA"],
  "Bachelor of Science in Computer Engineering": ["CPE", "CPEA", "CPES"],
  "Bachelor of Science in Electrical Engineering": ["EE", "EEA", "EEL"],
  "Bachelor of Science in Electronics Engineering": ["ECE", "ECEL", "ECEA"],
  "Bachelor of Science in Industrial Engineering": ["IE", "IEA", "IEL", "IES"],
  "Bachelor of Science in Mechanical Engineering": ["ME", "MEA", "MES"],

  // ── Political Science ──
  "Bachelor of Arts in Political Science major in International Relations and Foreign Service": ["IRF", "FOS"],
  "Bachelor of Arts in Political Science major in Law and Policy Studies": ["LPS"],
};

// Department -> prefixes shared by ALL its programs. Keys must match the exact
// `department` strings used in courseMap above.
const DEPARTMENT_SHARED_PREFIXES = {
  "Department of Computer, Information Sciences and Mathematics": ["CIS"],
  "Department of Fine Arts": ["FAD"],
  "Department of Sociology, Anthropology and History": ["SOAN"],
  "Department of Accountancy": ["AC", "ACM"], // REVIEW: AC = accountancy core, ACM = thesis
  "Department of Business Administration": ["CBA", "BAC"], // REVIEW: business core + research
  "Department of Hospitality and Tourism": ["DHT"],
  "Department of Political Science": ["POS"],
  "Department of Teacher Education": ["EDUC"],
  "Department of Architecture": ["AD"], // REVIEW: AD = shared design/elective prefix
  // Engineering math/science/GE shared across all engineering departments:
  "Department of Chemical Engineering": ["EM", "ES", "GEM", "GEW"], // REVIEW
  "Department of Civil Engineering": ["EM", "ES", "GEM", "GEW"], // REVIEW
  "Department of Computer Engineering": ["EM", "ES", "GEM", "GEW"], // REVIEW
  "Department of Electrical & Electronics Engineering": ["EM", "ES", "GEM", "GEW"], // REVIEW
  "Department of Industrial Engineering": ["EM", "ES", "GEM", "GEW"], // REVIEW
  "Department of Mechanical and Manufacturing Engineering": ["EM", "ES", "GEM", "GEW"], // REVIEW
};

// Prefixes for subjects every program takes regardless of course:
// NSTP (mandated), GE / GE-* (general education + free electives),
// TPE (PATH-FIT college PE), EDM (USC mission core).
const UNIVERSAL_PREFIXES = ["NSTP", "GE", "TPE", "EDM"];

/** Own ∪ department-shared ∪ universal prefixes for a program. [] if unknown. */
function subjectPrefixesFor(programName) {
  const entry = courseMap[programName];
  if (!entry) return [];               // unknown/stale program -> no subjects
  const own = PROGRAM_PREFIXES[programName] || [];
  const shared = DEPARTMENT_SHARED_PREFIXES[entry.department] || [];
  return [...new Set([...own, ...shared, ...UNIVERSAL_PREFIXES])];
}

// LOOKUP UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/** Return the entry for an exact course name, or null. */
function lookup(courseName) {
  return courseMap[courseName] ?? null;
}

/** Return all courses belonging to a given department. */
function byDepartment(deptName) {
  return Object.entries(courseMap)
    .filter(([, v]) => v.department === deptName)
    .map(([course, v]) => ({ course, ...v }));
}

/** Return all courses belonging to a given school. */
function bySchool(schoolName) {
  return Object.entries(courseMap)
    .filter(([, v]) => v.school === schoolName)
    .map(([course, v]) => ({ course, ...v }));
}

/** Print a formatted summary of the full map, grouped by school → department. */
function printFullMap() {
  // Build school → dept → [courses] tree
  const tree = {};
  for (const [course, { school, department }] of Object.entries(courseMap)) {
    if (!tree[school]) tree[school] = {};
    if (!tree[school][department]) tree[school][department] = [];
    tree[school][department].push({ course });
  }

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║         UNIVERSITY OF SAN CARLOS — COURSE MAP               ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  for (const [school, depts] of Object.entries(tree)) {
    console.log(`🏫  ${school}`);
    for (const [dept, courses] of Object.entries(depts)) {
      console.log(`  📂  ${dept}`);
      for (const { course } of courses) {
        console.log(`       • ${course}`);
      }
    }
    console.log();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERACTIVE CLI
// ─────────────────────────────────────────────────────────────────────────────

const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function searchFlow() {
  const query = (await ask("\n  Enter course name (or part of it): ")).trim().toLowerCase();
  const matches = Object.entries(courseMap).filter(([name]) =>
    name.toLowerCase().includes(query)
  );

  if (matches.length === 0) {
    console.log("  ⚠️  No matching courses found.");
    return;
  }

  console.log(`\n  Found ${matches.length} result(s):\n`);
  for (const [course, { school, department }] of matches) {
    console.log(`  📘  ${course}`);
    console.log(`      School     : ${school}`);
    console.log(`      Department : ${department}\n`);
  }
}

async function deptFlow() {
  const query = (await ask("\n  Enter department name (or part of it): ")).trim().toLowerCase();
  const results = Object.entries(courseMap)
    .filter(([, v]) => v.department.toLowerCase().includes(query))
    .map(([course, v]) => ({ course, ...v }));

  if (results.length === 0) {
    console.log("  ⚠️  No courses found for that department.");
    return;
  }

  const dept = results[0].department;
  console.log(`\n  Courses under "${dept}":\n`);
  for (const { course, school } of results) {
    console.log(`  • ${course}`);
    console.log(`    School : ${school}\n`);
  }
}

async function mainMenu() {
  while (true) {
    console.log("\n════════════════════════════════════════════════");
    console.log("  USC COURSE MAPPER");
    console.log("════════════════════════════════════════════════");
    console.log("  1. Search for a course");
    console.log("  2. Browse by department");
    console.log("  3. Print full map");
    console.log("  4. Exit");
    console.log("────────────────────────────────────────────────");

    const choice = (await ask("  Choose (1-4): ")).trim();
    switch (choice) {
      case "1": await searchFlow(); break;
      case "2": await deptFlow();   break;
      case "3": printFullMap();     break;
      case "4":
        console.log("\n  Goodbye! 👋\n");
        rl.close();
        process.exit(0);
        break;
      default:
        console.log("  ⚠️  Enter 1–4.");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS  (for use as a module)
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  courseMap,
  lookup,
  byDepartment,
  bySchool,
  PROGRAM_PREFIXES,
  DEPARTMENT_SHARED_PREFIXES,
  UNIVERSAL_PREFIXES,
  subjectPrefixesFor,
};

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT  (only when run directly)
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const total = Object.keys(courseMap).length;
  console.log(`\n  ${total} courses loaded across 7 schools.\n`);
  mainMenu();
}
