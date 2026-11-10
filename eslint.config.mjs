import globals from "globals";

const rules = {
  "no-undef": "error",
  "no-unreachable": "error",
  "no-dupe-keys": "error",
  "no-constant-binary-expression": "error",
  "no-unexpected-multiline": "error",
  "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_" }],
};

export default [
  { ignores: ["node_modules/**", "dist/**", ".local/**"] },
  {
    files: ["server/**/*.js", "tests/**/*.js", "scripts/**/*.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
    rules,
  },
  {
    files: ["src/**/*.{js,jsx}", "scripts/*.mjs", "*.mjs"],
    languageOptions: {
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    rules,
  },
  {
    files: ["tests/browser.test.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
