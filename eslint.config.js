import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "dist-e2e"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // The end-to-end harness is Node and Playwright, not React.
    //
    // Two of the rules above are actively wrong here, and neither is being
    // "relaxed" — they simply describe a different language:
    //
    //   react-hooks/rules-of-hooks  fires on Playwright's `use` callback,
    //     which every fixture takes (`async ({ page }, use) => …`) and which
    //     has nothing to do with React's use().
    //   no-empty-pattern            fires on `async ({}, use) => …`, the
    //     documented way to declare a fixture that depends on no other
    //     fixture.
    files: ["e2e/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "no-empty-pattern": "off",
    },
  }
);
