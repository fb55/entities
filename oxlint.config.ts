import { defineConfig } from "oxlint";

/**
 * Rules turned off (each group says why they do not fit this code).
 *
 * @param rules The names of the rules.
 * @returns The rules, each turned off.
 */
const off = (...rules: string[]): Record<string, "off"> =>
    Object.fromEntries(rules.map((rule) => [rule, "off"]));

export default defineConfig({
    plugins: [
        "eslint",
        "typescript",
        "unicorn",
        "oxc",
        "import",
        "jsdoc",
        "node",
        "promise",
        "vitest",
    ],
    // There is no built-in rule for function-local regex allocation.
    // Enable all stable rule categories.
    categories: {
        correctness: "error",
        suspicious: "error",
        pedantic: "error",
        perf: "error",
        style: "error",
        restriction: "error",
    },
    options: { typeAware: true, reportUnusedDisableDirectives: "error" },
    // The benchmark is type-checked separately.
    ignorePatterns: ["scripts/benchmark/", "test/fixtures/html5lib-tests/"],
    rules: {
        eqeqeq: ["error", "smart"],
        "one-var": ["error", "never"],
        "func-style": ["error", "declaration", { allowArrowFunctions: true }],
        "prefer-arrow-callback": ["error", { allowNamedFunctions: true }],
        "prefer-destructuring": ["error", { object: true, array: false }],
        "capitalized-comments": [
            "error",
            "always",
            // (Lines continuing a comment continue its sentence.)
            { ignorePattern: "oxfmt-ignore", ignoreConsecutiveComments: true },
        ],
        yoda: ["error", "never"],
        "no-unused-vars": [
            "error",
            { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "unicorn/numeric-separators-style": [
            "error",
            { hexadecimal: { onlyIfContainsSeparator: true } },
        ],
        "typescript/explicit-member-accessibility": [
            "error",
            { accessibility: "no-public" },
        ],
        "typescript/explicit-function-return-type": [
            "error",
            { allowExpressions: true },
        ],
        "typescript/no-confusing-void-expression": [
            "error",
            { ignoreArrowShorthand: true },
        ],
        "typescript/no-unnecessary-condition": "error",
        "typescript/switch-exhaustiveness-check": [
            "error",
            { considerDefaultExhaustiveForUnions: true },
        ],
        "vitest/prefer-lowercase-title": ["error", { ignore: ["describe"] }],
        "vitest/consistent-test-filename": [
            "error",
            { pattern: String.raw`\.spec\.ts$` },
        ],
        "vitest/consistent-test-it": ["error", { fn: "it" }],
        // The entity tables pack code units, flags, and offsets into integers.
        ...off("no-magic-numbers", "no-bitwise", "id-length"),
        // Text is encoded in UTF-16 code units.
        ...off("unicorn/prefer-code-point"),
        // Code-unit regexes must match lone surrogates, including in the fixtures.
        ...off("require-unicode-regexp"),
        // `null` and `undefined` are part of the trie and lookup representations.
        ...off("unicorn/no-null", "no-undefined"),
        // Modern syntax and the runtime's features are fine.
        ...off(
            "oxc/no-async-await",
            "oxc/no-optional-chaining",
            "oxc/no-rest-spread-properties",
            "no-plusplus",
            "no-continue",
            "no-ternary",
            "no-nested-ternary",
            "unicorn/no-nested-ternary",
            "unicorn/no-array-reduce",
            "promise/avoid-new",
            "node/no-top-level-await",
            "node/no-sync",
            "import/no-nodejs-modules",
            "unicorn/import-style",
        ),
        // Async functions without `await` return their values and errors as promises.
        ...off("require-await", "typescript/require-await"),
        // Sizes, and orders that do not follow the code's structure.
        ...off(
            "max-params",
            "max-statements",
            "max-lines",
            "max-lines-per-function",
            "max-classes-per-file",
            "unicorn/max-nested-calls",
            "sort-keys",
            "no-use-before-define",
            "no-inline-comments",
            "init-declarations",
        ),
        // Keep branch-heavy decoder and generator logic inline.
        ...off("complexity", "max-depth", "curly", "no-multi-assign"),
        // Nullish equality is allowed by eqeqeq's smart mode.
        ...off("no-eq-null"),
        // Keep the existing import and export order and module structure.
        ...off(
            "sort-imports",
            "import/consistent-type-specifier-style",
            "import/no-named-export",
            "import/no-default-export",
            "import/prefer-default-export",
            "import/group-exports",
            "import/exports-last",
            "import/no-relative-parent-imports",
        ),
        // The formatter writes hex digits in lowercase.
        ...off("unicorn/number-literal-case"),
        // Keep existing substring calls in the scanners.
        ...off("unicorn/prefer-string-slice"),
        // TypeScript supplies the types and infers them for readonly parameters.
        ...off(
            "jsdoc/require-param-type",
            "jsdoc/require-returns-type",
            "jsdoc/require-yields-type",
            "jsdoc/require-throws-type",
            "typescript/prefer-readonly-parameter-types",
            "typescript/no-non-null-assertion",
        ),
        // Method signatures are chosen for how they check and infer.
        ...off("typescript/method-signature-style"),
        // Preserve existing constructor parameter properties and enum numbering.
        ...off(
            "typescript/parameter-properties",
            "typescript/prefer-enum-initializers",
        ),
        // Tests: tables of cases, assertions in helpers, and `toBe(true)` (stricter than `toBeTruthy()`).
        ...off(
            "vitest/prefer-expect-assertions",
            "vitest/require-test-timeout",
            "vitest/no-conditional-in-test",
            "vitest/no-importing-vitest-globals",
            "vitest/require-hook",
            "vitest/max-expects",
            "vitest/prefer-describe-function-title",
            "vitest/prefer-to-be-truthy",
            "vitest/prefer-to-be-falsy",
        ),
    },
    overrides: [
        {
            // The published library runs in browsers and has no runtime dependencies.
            files: ["src/**/*.ts"],
            excludeFiles: ["**/*.spec.ts"],
            rules: {
                "import/no-nodejs-modules": "error",
                "no-restricted-imports": [
                    "error",
                    {
                        patterns: [
                            {
                                regex: "^[^.]",
                                message:
                                    "Use a relative import in the dependency-free library.",
                            },
                        ],
                    },
                ],
            },
        },
        {
            // The formatter preserves the generated literals as written.
            files: ["src/generated/**"],
            rules: off("import/no-anonymous-default-export"),
        },
        {
            // The XML decoder shares the base class contract and handles only five names.
            files: ["src/decode.ts"],
            rules: {
                ...off("default-case"),
                "class-methods-use-this": [
                    "error",
                    { exceptMethods: ["endNamedEntity"] },
                ],
                "no-shadow": ["error", { allow: ["length"] }],
            },
        },
        {
            // Generator scripts use console output and document their purpose and data formats.
            files: ["scripts/*.ts"],
            rules: off("no-console", "jsdoc/require-returns"),
        },
        {
            // The generator treats an empty alias as absent.
            files: ["scripts/write-encode-map.ts"],
            rules: {
                "typescript/strict-boolean-expressions": [
                    "error",
                    { allowNullableString: true },
                ],
            },
        },
        {
            // Test tables use namespace imports, inferred mocks and concise assertion callbacks.
            files: ["**/*.spec.ts"],
            rules: off(
                "typescript/explicit-function-return-type",
                "typescript/explicit-module-boundary-types",
                "typescript/strict-void-return",
                "import/no-namespace",
                "jsdoc/require-returns",
                "vitest/require-mock-type-parameters",
                "vitest/padding-around-test-blocks",
                "vitest/no-hooks",
                "vitest/require-top-level-describe",
                "vitest/prefer-called-once",
                "vitest/prefer-called-times",
                "vitest/no-conditional-expect",
            ),
        },
        {
            // Vendored tokenizer cases are registered dynamically, with different CI and local missing-fixture handling.
            // The fixture JSON is asserted to match the tokenizer test schema.
            files: ["src/html5lib.spec.ts"],
            rules: {
                ...off(
                    "vitest/prefer-each",
                    "vitest/no-conditional-tests",
                    "vitest/valid-title",
                    "vitest/expect-expect",
                    "vitest/prefer-todo",
                    "vitest/no-disabled-tests",
                    "node/no-process-env",
                    "no-console",
                    "prefer-named-capture-group",
                    "typescript/no-unsafe-type-assertion",
                ),
                "typescript/strict-boolean-expressions": [
                    "error",
                    { allowNullableBoolean: true, allowNullableString: true },
                ],
            },
        },
    ],
});
