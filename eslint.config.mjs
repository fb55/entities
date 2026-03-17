import { fileURLToPath } from "node:url";
import { includeIgnoreFile } from "@eslint/compat";
import feedicFlatConfig from "@feedic/eslint-config";
import { commonTypeScriptRules } from "@feedic/eslint-config/typescript";
import { defineConfig } from "eslint/config";
import eslintConfigBiome from "eslint-config-biome";
import tseslint from "typescript-eslint";

const gitignorePath = fileURLToPath(new URL(".gitignore", import.meta.url));

export default defineConfig([
    includeIgnoreFile(gitignorePath),
    {
        linterOptions: {
            reportUnusedDisableDirectives: "error",
        },
    },
    {
        ignores: ["eslint.config.{js,cjs,mjs}"],
    },
    ...feedicFlatConfig,
    {
        rules: {
            "capitalized-comments": [
                2,
                "always",
                {
                    ignorePattern: "biome",
                },
            ],
            "n/no-unpublished-import": 0,
        },
    },
    {
        files: ["**/*.ts"],
        extends: [...tseslint.configs.recommended],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                sourceType: "module",
                project: "./tsconfig.eslint.json",
            },
        },
        rules: {
            ...commonTypeScriptRules,
        },
    },
    {
        files: ["**/*.spec.ts"],
        rules: {
            "n/no-unsupported-features/es-builtins": 0,
            "n/no-unsupported-features/node-builtins": 0,
        },
    },
    {
        files: ["scripts/**"],
        rules: {
            "n/no-unsupported-features/es-builtins": 0,
            "n/no-unsupported-features/node-builtins": 0,
        },
    },
    {
        files: ["src/generated/**"],
        rules: {
            "multiline-comment-style": 0,
            "capitalized-comments": 0,
            "unicorn/escape-case": 0,
            "unicorn/no-hex-escape": 0,
            "unicorn/numeric-separators-style": 0,
            "unicorn/prefer-spread": 0,
        },
    },
    eslintConfigBiome,
]);
