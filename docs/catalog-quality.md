# Course catalog quality

SWAPPR keeps the imported `sql/courses.db` unchanged. Missing values can be
filled from reviewed USC schedule data when both the subject code and title
match. Matching variants or consistent prefixes still cover rows with no
reviewed entry. Only recognized general education, NSTP, PE, and
institution-wide mission subjects enter **General Education & Electives**
automatically.

The bundled catalog has 2,465 subjects, including 138 with missing reservations.
Existing normalization fills 82. A November 2026 check of the [public USC
schedule](https://ismis.usc.edu.ph/EnrolledCourse/CourseScheduleOffered) supplies
reservations for 37 more exact code-and-title matches. The remaining 19 stay
unassigned. Of those, the schedule returned no matching code for 18 and no
reservation for one.

`lib/catalog-reservations.json` keeps the reviewed codes, titles, and reserved
units. The Subject Filter shows all reserved units when the schedule lists more
than one. A school, office, or cross-listed reservation does not establish a
subject's owning department or which degree programs require it. Run
`node lib/coverage.js` when importing a new catalog.

## Prefix review

| Prefix | What the catalog supports |
| --- | --- |
| `AA` | Seven accountancy records and one Fine Arts record. The Fine Arts row stays out of Accountancy. The current Internal Auditing assignment remains until a USC curriculum confirms wider scope. |
| `SCED`, `PHSCED` | `SCED` has undergraduate biology offerings and graduate research records. Program results omit the latter and exclude `PHSCED`, whose listings are graduate-level. |
| `AD` | Most rows belong to Architecture. Two senior high school records stay out of undergraduate lists. Sharing across Architecture, Landscape Architecture, and Interior Design requires curriculum confirmation. |
| `EM`, `ES`, `GEM`, `GEW` | The schedule reserves `EM 1202` for the School of Engineering and `ES-MECH` for Chemical, Electrical and Electronics, and Industrial Engineering. These rows confirm shared reservations. Existing whole-prefix rules still need degree-level curricula, particularly for `GEM` and `GEW`. |
| `THC`, `DHT` | `THC` course titles cover both tourism and hospitality, so SWAPPR assigns it to those two degree programs. The Culinary Arts diploma and `DHT` scope still require curriculum confirmation. |
| `BIOL`, `ECON`, `ACC`, `ACCTG` | These records include graduate, Science Education, senior high, or Nutrition and Dietetics courses. Keep the prefixes separate until an undergraduate curriculum confirms a particular subject. |

The university lists undergraduate and graduate programs separately. The public
program lists do not provide complete subject-level curricula. Use the [USC
undergraduate programs](https://usc.edu.ph/catholic-educational-institution-academics/undergraduate-programs),
[graduate programs](https://usc.edu.ph/catholic-educational-institution-academics/graduate-and-professional-programs),
[mission courses](https://usc.edu.ph/catholic-educational-institution-academics/departments/office-of-general-education-and-mission),
and [official course schedule](https://ismis.usc.edu.ph/EnrolledCourse/CourseScheduleOffered?page=176)
alongside program curricula when confirming remaining rows.
