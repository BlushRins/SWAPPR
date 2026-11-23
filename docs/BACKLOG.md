# Backlog

Future tasks captured from items that were explicitly marked out of scope or
deferred in recent design notes.

## Product and UX

- [x] Add subject-card to notebook filtering once notebook-to-subject data exists.
  - Source: `docs/archive/2026-06-25-program-subject-filter-design.md`
  - Future execution: model the notebook/subject relationship first, then make
    subject cards interactive and filter notebooks by the selected subject.
- [x] Add course search and per-course pages.
  - Source: `docs/archive/2026-06-24-course-department-mapping-design.md`
  - Future execution: define the course detail payload, add search UI, and route
    each result to a per-course view.
- [x] Filter notebooks by course.
  - Source: `docs/archive/2026-06-24-course-department-mapping-design.md`
  - Future execution: establish course-level notebook metadata, then let course
    selections narrow notebook results.

## Data Quality

See the [catalog review](catalog-quality.md) for the current coverage and remaining curriculum checks.

- [ ] Confirm reservations for the remaining 19 subjects without metadata.
  - The runtime catalog fills 82 missing rows from catalog evidence and 37
    from exact matches in the USC schedule. See [catalog quality](catalog-quality.md).
- [ ] Review graduate-program, global, noise, and cross-listed subject prefixes.
  - Source: `docs/archive/2026-06-25-program-subject-filter-design.md`
  - Future execution: revisit ignored prefixes when graduate programs or global
    subject groups become registerable/filterable.
- [x] Re-seed `seed.js` users or fixtures to use full program names.
  - Source: `docs/archive/2026-06-25-program-subject-filter-design.md`
  - Future execution: align seed data with `course_mapper.js` program names so
    test users exercise the same mapping path as registered users.
- [x] Decide whether department cleanup should mutate the database.
  - Source: `docs/archive/2026-06-24-department-cleaning-design.md`
  - Future execution: compare runtime normalization against a migration/backfill,
    then choose whether cleaned department names should be stored.
- [x] Expand department-name normalization into a general abbreviation table.
  - Source: `docs/archive/2026-06-24-department-cleaning-design.md`
  - Future execution: replace the one-off abbreviation handling with a reviewed
    table and tests for known department abbreviations.
- [ ] Make the department title-casing small-word list configurable if more
  naming exceptions appear.
  - Source: `docs/archive/2026-06-24-department-cleaning-design.md`
  - Future execution: keep the inline constant until real exceptions justify a
    config surface.

## Prefix-Map Accuracy Review

- [ ] Confirm whether `AA` auditing subjects belong to all accountancy programs.
  - Source: `docs/archive/2026-06-25-prefix-map-deferred-review.md`
  - Future execution: if `AA` is shared accountancy core, move it into the
    Department of Accountancy shared prefixes.
- [x] Confirm the Science Education prefixes `SCED` and `PHSCED`.
  - Source: `docs/archive/2026-06-25-prefix-map-deferred-review.md`
  - Future execution: decide whether BSED-Science should include `SCED`,
    `PHSCED`, or both.
- [ ] Confirm whether `AD` is a shared Department of Architecture prefix.
  - Source: `docs/archive/2026-06-25-prefix-map-deferred-review.md`
  - Future execution: keep `AD` shared only if it is a design/elective core
    across Architecture, Landscape Architecture, and Interior Design.
- [ ] Confirm whether `EM`, `ES`, `GEM`, and `GEW` are shared across all
  engineering departments.
  - Source: `docs/archive/2026-06-25-prefix-map-deferred-review.md`
  - Future execution: remove any prefix that turns out to be department-specific.
- [ ] Confirm the Hospitality and Tourism scope for `THC` and `DHT`.
  - Source: `docs/archive/2026-06-25-prefix-map-deferred-review.md`
  - Future execution: verify whether `THC` is tourism-specific before keeping it
    shared across Hospitality, Tourism, and Culinary.
- [ ] Decide whether unmapped variant prefixes should fold into parent programs.
  - Source: `docs/archive/2026-06-25-prefix-map-deferred-review.md`
  - Future execution: review `BIOL` vs `BIO`, `ECON` vs `ECN`, and `ACC` /
    `ACCTG` vs `AC`; run `node lib/coverage.js` for a fresh orphan-prefix sweep.

*Previous tasks completed:*
- [x] Refactor Course vs Department Logic in Seed Data
- [x] [HIGH PRIORITY] Course to Department Constants Mapping
