// Tailwind supplies layout utilities only. Its theme points at tokens.css,
// so the generated preflight and spacing carry the app's own values.
module.exports = {
  content: [
    "./public/*.html",
    "./public/js/**/*.js",
    "!./public/js/**/*.test.js",
  ],
  darkMode: "class",
  theme: {
    // A function, so Tailwind keeps the token instead of its default blue.
    ringColor: { DEFAULT: () => "var(--color-focus)" },
    ringOpacity: { DEFAULT: "1" },
    extend: {
      fontFamily: { sans: ["var(--font-sans)"] },
      borderColor: { DEFAULT: "var(--color-divider)" },
      ringOffsetColor: { DEFAULT: "var(--color-surface)" },
      // Preflight reads these defaults for placeholders and focus rings.
      colors: {
        gray: { 400: "var(--color-placeholder)" },
        blue: { 300: "var(--color-focus)", 500: "var(--color-focus)" },
      },
      spacing: {
        0.5: "var(--space-3xs)",
        1: "var(--space-2xs)",
        2: "var(--space-xs)",
        3: "var(--space-sm)",
        4: "var(--space-md)",
        6: "var(--space-lg)",
        10: "var(--space-xl)",
        16: "var(--space-2xl)",
      },
    },
  },
};
