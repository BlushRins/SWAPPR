module.exports = {
  content: [
    "./public/*.html",
    "./public/js/**/*.js",
    "!./public/js/**/*.test.js",
    "!./public/js/vendor/lucide.js",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
};
