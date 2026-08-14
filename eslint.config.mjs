import eslint from "@eslint/js"
import nextPlugin from "@next/eslint-plugin-next"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"
import tseslint from "typescript-eslint"

const authoredFiles = ["**/*.{js,mjs,cjs,ts,tsx}"]
const nextFiles = ["apps/**/*.{ts,tsx}"]

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/app/.well-known/workflow/**",
      "**/dist/**",
      "**/coverage/**",
      "**/*.tsbuildinfo",
      "packages/db/generated/**",
      "archive/**",
      "briefs/**",
      "capture/**",
      "logs/**",
      ".backups/**",
      ".claude/**",
      // Must be `**/.vercel/**`, not `.vercel/**`: per-app Vercel builds write
      // minified output to apps/*/.vercel/output, which a root-relative pattern
      // does not match. Because `npm run lint` chains eslint && boundaries &&
      // migrations, those bundles failing lint silently skipped both repo
      // invariants — the same trap the design-sync note below describes.
      "**/.vercel/**",
      "docs/ui-preview/**",
      // design-sync build output — gitignored, generated, and not ours to lint.
      // While these were scanned, `npm run lint` exited 1 on 263 pre-existing
      // errors in vendored bundles, so the repo-invariant checks chained after
      // eslint with && never ran at all.
      ".ds-sync/**",
      "ds-bundle/**",
    ],
  },
  {
    ...eslint.configs.recommended,
    files: authoredFiles,
    languageOptions: {
      ...eslint.configs.recommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  ...tseslint.configs.recommended.map(config => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  {
    files: ["**/*.{ts,tsx}"],
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "no-undef": "off",
      // Baseline debt: enable after the first hotspot-decomposition pass.
      "no-control-regex": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: nextFiles,
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    settings: {
      next: {
        rootDir: ["apps/*/"],
      },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.flat.recommended.rules,
      // Existing UI debt is tracked in TD-007, TD-008, and TD-010. Keep the
      // correctness-critical Rules of Hooks enabled while those files migrate.
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-img-element": "off",
      "react-hooks/error-boundaries": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
)
