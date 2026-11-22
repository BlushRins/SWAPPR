// Run: node test/browser/pagination.test.js
const assert = require("assert");
const { paginationItems } = require("../../public/js/pagination");

assert.deepStrictEqual(
  paginationItems(1, 4),
  [1, 2, 3, 4],
  "small page ranges render every page"
);

assert.deepStrictEqual(
  paginationItems(1, 12),
  [1, 2, 3, "ellipsis", 12],
  "first page collapses the distant middle"
);

assert.deepStrictEqual(
  paginationItems(6, 12),
  [1, "ellipsis", 5, 6, 7, "ellipsis", 12],
  "middle page keeps nearby pages and both edges"
);

assert.deepStrictEqual(
  paginationItems(12, 12),
  [1, "ellipsis", 10, 11, 12],
  "last page collapses the distant middle"
);

console.log("pagination.test.js OK");
