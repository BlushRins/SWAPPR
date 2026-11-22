# Course catalog quality

SWAPPR keeps the imported `sql/courses.db` unchanged. The app fills a missing
department when a matching subject variant has one unambiguous department or
when at least two records with the same prefix agree. Only the recognized
general education, NSTP, PE and institution-wide mission subjects enter
**General Education & Electives** automatically.

The bundled catalog has 2,465 subjects. Normalization fills 82 of its 138
missing departments. The remaining 56 stay unassigned. The bundled backup has
no extra department values for those missing rows. The scraper is absent
from this repository. Run `node lib/coverage.js` when importing a new catalog.

## Prefix review

| Prefix | What the catalog supports |
| --- | --- |
| `AA` | Seven accountancy records and one Fine Arts record. The Fine Arts row stays out of Accountancy. The current Internal Auditing assignment remains until a USC curriculum confirms wider scope. |
| `SCED`, `PHSCED` | `SCED` has undergraduate biology offerings and graduate research records. Program results omit the latter and exclude `PHSCED`, whose listings are graduate-level. |
| `AD` | Most rows belong to Architecture. Two senior high school records stay out of undergraduate lists. Sharing across Architecture, Landscape Architecture, and Interior Design requires curriculum confirmation. |
| `EM`, `ES`, `GEM`, `GEW` | The tagged rows cover Civil, Chemical, and Computer Engineering. Existing sharing rules need confirmation from the remaining programs. |
| `THC`, `DHT` | `THC` course titles cover both tourism and hospitality, so SWAPPR assigns it to those two degree programs. The Culinary Arts diploma and `DHT` scope still require curriculum confirmation. |
| `BIOL`, `ECON`, `ACC`, `ACCTG` | These records include graduate, Science Education, senior high, or Nutrition and Dietetics courses. Keep the prefixes separate until an undergraduate curriculum confirms a particular subject. |

The university lists undergraduate and graduate programs separately. The public
program lists do not provide complete subject-level curricula. Use the [USC
undergraduate programs](https://usc.edu.ph/catholic-educational-institution-academics/undergraduate-programs),
[graduate programs](https://usc.edu.ph/catholic-educational-institution-academics/graduate-and-professional-programs),
[mission courses](https://usc.edu.ph/catholic-educational-institution-academics/departments/office-of-general-education-and-mission),
and [official course schedule](https://ismis.usc.edu.ph/EnrolledCourse/CourseScheduleOffered?page=176)
alongside program curricula when confirming remaining rows.
