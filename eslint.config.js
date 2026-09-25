// @ts-check
import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/target/**",
      "shell/.ags/**",
      "shell/@girs/**",
      "distro/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["**/*.mjs", "**/*.config.ts", "scripts/**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  },
  {
    files: ["shell/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        // GJS globals
        imports: "readonly",
        print: "readonly",
        printerr: "readonly",
        log: "readonly",
        logError: "readonly",
        ARGV: "readonly",
        SRC: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
      },
    },
  },
)
