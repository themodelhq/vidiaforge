
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * VidiaForge — ESLint flat configuration
 *
 * Goals:
 * - Preserve the Next.js Core Web Vitals and TypeScript presets.
 * - Detect unused variables and unsafe TypeScript patterns.
 * - Restore React Hook dependency checks.
 * - Prevent debugger statements and unreachable code.
 * - Avoid turning every stylistic warning into a release blocker.
 * - Ignore generated output and dependency directories.
 */

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    name: "vidiaforge/code-quality",

    rules: {
      /* ------------------------------------------------------------------ */
      /* TypeScript                                                         */
      /* ------------------------------------------------------------------ */

      // Warn while existing violations are being repaired.
      "@typescript-eslint/no-explicit-any": "warn",

      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      "@typescript-eslint/no-non-null-assertion": "warn",

      "@typescript-eslint/ban-ts-comment": [
        "warn",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
          minimumDescriptionLength: 10,
        },
      ],

      "@typescript-eslint/prefer-as-const": "warn",

      // The TypeScript-aware rule replaces the core rule.
      "no-unused-vars": "off",

      /* ------------------------------------------------------------------ */
      /* React and React Hooks                                              */
      /* ------------------------------------------------------------------ */

      "react-hooks/exhaustive-deps": "warn",

      "react-hooks/purity": "warn",

      "react/no-unescaped-entities": "warn",

      "react/display-name": "warn",

      // TypeScript provides component prop typing.
      "react/prop-types": "off",

      // Keep compiler diagnostics visible without making every existing
      // compiler-rule finding immediately block the build.
      "react-compiler/react-compiler": "warn",

      /* ------------------------------------------------------------------ */
      /* Next.js                                                            */
      /* ------------------------------------------------------------------ */

      "@next/next/no-img-element": "warn",

      "@next/next/no-html-link-for-pages": "warn",

      /* ------------------------------------------------------------------ */
      /* JavaScript correctness                                             */
      /* ------------------------------------------------------------------ */

      "no-debugger": "error",

      "no-unreachable": "error",

      "no-fallthrough": "error",

      "no-case-declarations": "error",

      "no-var": "error",

      "prefer-const": "warn",

      "eqeqeq": [
        "warn",
        "always",
        {
          null: "ignore",
        },
      ],

      "no-constant-condition": [
        "error",
        {
          checkLoops: false,
        },
      ],

      "no-duplicate-imports": [
        "warn",
        {
          includeExports: true,
        },
      ],

      "no-redeclare": "error",

      "no-useless-escape": "warn",

      "no-irregular-whitespace": "error",

      "no-mixed-spaces-and-tabs": "error",

      "no-console": [
        "warn",
        {
          allow: ["warn", "error"],
        },
      ],

      // Empty catch blocks must be deliberate and visibly documented.
      "no-empty": [
        "warn",
        {
          allowEmptyCatch: false,
        },
      ],
    },
  },

  /* ---------------------------------------------------------------------- */
  /* Test-specific overrides                                                */
  /* ---------------------------------------------------------------------- */

  {
    name: "vidiaforge/test-files",

    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "tests/**/*.ts",
      "tests/**/*.tsx",
    ],

    rules: {
      // Tests may log diagnostic information, but debugger statements
      // and unreachable code remain prohibited.
      "no-console": "off",
    },
  },

  /* ---------------------------------------------------------------------- */
  /* Generated files and excluded directories                               */
  /* ---------------------------------------------------------------------- */

  {
    name: "vidiaforge/ignored-files",

    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "next-env.d.ts",
      "examples/**",
      "skills/**",
      "artifacts/**",
      "tmp/**",
      "temp/**",
    ],
  },
];

export default eslintConfig;
