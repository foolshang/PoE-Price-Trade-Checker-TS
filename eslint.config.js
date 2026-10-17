import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/dist-*/**", "**/out/**", "tests/parity/golden/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    // the browser tests run code inside the page (window.*): they are checked by running, not by the type checker
    files: ["tests/web/**", "tests/desktop/**"],
    rules: { "@typescript-eslint/ban-ts-comment": "off" },
  },
);
