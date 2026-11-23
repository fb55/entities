/* oxlint-disable typescript/no-unsafe-type-assertion -- The vendored tokenizer schema defines the fixture JSON and the payload shape for each token type. */

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
    DecodingMode,
    decodeHTML,
    decodeHTMLAttribute,
    HtmlEntityDecoder,
} from "./decode.js";

/**
 * Conformance tests against the WHATWG html5lib-tests tokenizer fixtures,
 * vendored as a git submodule at `test/fixtures/html5lib-tests` (kept
 * up-to-date by dependabot).
 *
 * The fixtures drive a full HTML tokenizer; this library only decodes
 * character references. Tests are therefore filtered mechanically:
 *
 * Included:
 *
 * 1. Data-state tests (no `initialStates` beyond `Data state`, no
 *    `lastStartTag`) whose output consists solely of `Character` tokens and
 *    whose input contains neither `<` (would require tag-context modelling)
 *    nor `\r` (would require input-stream preprocessing). The concatenated
 *    character data must equal `decodeHTML(input)`, and also the output of
 *    a streaming `HtmlEntityDecoder` fed one character per chunk.
 * 2. Tests emitting exactly one `<h a=…>` start tag with a single `a`
 *    attribute — the fixtures' template for attribute-value character
 *    reference tests. The expected attribute value must equal
 *    `decodeHTMLAttribute` (and the streaming decoder in attribute mode)
 *    applied to the raw attribute value extracted from the input.
 *
 * Everything else is excluded, as it requires tokenizer context that this
 * library does not model. `errors` arrays are ignored: this library does
 * not emit tokenizer parse errors.
 */

interface TokenizerTest {
    description: string;
    input: string;
    output: [type: string, ...data: unknown[]][];
    initialStates?: string[];
    lastStartTag?: string;
    doubleEscaped?: boolean;
}

const FIXTURE_FILES = [
    "entities",
    "namedEntities",
    "numericEntities",
    "pendingSpecChanges",
];

/** Template used by the fixtures for attribute-value entity tests. */
const ATTRIBUTE_TEMPLATE = /^<h a=(?<quote>["']?)(?<value>.*)\k<quote>>$/s;

/**
 * Guards against a submodule update silently causing the filter to exclude
 * everything. As of html5lib-tests 224991e the filter includes 4626 tests.
 */
const MINIMUM_INCLUDED_TESTS = 4000;

/**
 * Decodes a string by feeding an `HtmlEntityDecoder` one character per chunk,
 * exercising the streaming state machine across chunk boundaries.
 * @param input The string to decode.
 * @param mode The decoding mode to use for each entity.
 * @returns The decoded string.
 */
function decodeStreaming(input: string, mode: DecodingMode): string {
    let result = "";
    const decoder = new HtmlEntityDecoder((codePoint) => {
        result += String.fromCodePoint(codePoint);
    });

    let index = 0;
    while (index < input.length) {
        const amp = input.indexOf("&", index);
        if (amp === -1) {
            result += input.slice(index);
            break;
        }
        result += input.slice(index, amp);

        decoder.startEntity(mode);
        let consumed = -1;
        for (
            let cursor = amp + 1;
            consumed === -1 && cursor < input.length;
            cursor++
        ) {
            consumed = decoder.write(input[cursor], 0);
        }
        if (consumed === -1) consumed = decoder.end();

        if (consumed === 0) {
            result += "&";
            index = amp + 1;
        } else {
            index = amp + consumed;
        }
    }

    return result;
}

const fixtureDirectory = new URL(
    "../test/fixtures/html5lib-tests/tokenizer/",
    import.meta.url,
);

type FixtureCase = [
    description: string,
    data: { input: string; expected: string; mode: DecodingMode },
];

/**
 * Applies the mechanical filter documented above and maps each included
 * fixture to an executable assertion.
 * @param tests The tests of a fixture file.
 * @returns The runnable cases for the file.
 */
function collectCases(tests: TokenizerTest[]): FixtureCase[] {
    const cases: FixtureCase[] = [];

    for (const test of tests) {
        const states = test.initialStates ?? ["Data state"];
        if (
            states.length !== 1 ||
            states[0] !== "Data state" ||
            test.lastStartTag !== undefined
        ) {
            continue;
        }

        const unescape = (value: string): string =>
            test.doubleEscaped === true
                ? (JSON.parse(`"${value}"`) as string)
                : value;
        const input = unescape(test.input);

        if (
            test.output.every(([type]) => type === "Character") &&
            !input.includes("<") &&
            !input.includes("\r")
        ) {
            const expected = test.output
                .map(([, data]) => unescape(data as string))
                .join("");

            cases.push([
                test.description,
                { input, expected, mode: DecodingMode.Legacy },
            ]);
        } else if (
            test.output.length === 1 &&
            test.output[0][0] === "StartTag"
        ) {
            const attributeValue =
                ATTRIBUTE_TEMPLATE.exec(input)?.groups?.["value"];
            const attributes = test.output[0][2] as Record<string, string>;
            if (
                attributeValue !== undefined &&
                test.output[0][1] === "h" &&
                Object.keys(attributes).length === 1 &&
                "a" in attributes
            ) {
                cases.push([
                    test.description,
                    {
                        input: attributeValue,
                        expected: unescape(attributes["a"]),
                        mode: DecodingMode.Attribute,
                    },
                ]);
            }
        }
    }

    return cases;
}

// oxlint-disable-next-line vitest/no-conditional-tests -- Fixture registration reads files from an optional local submodule.
if (existsSync(fixtureDirectory)) {
    describe("html5lib-tests tokenizer entity fixtures", () => {
        let includedCount = 0;

        const suites = FIXTURE_FILES.map((file) => {
            const { tests } = JSON.parse(
                readFileSync(new URL(`${file}.test`, fixtureDirectory), "utf8"),
            ) as { tests: TokenizerTest[] };

            const cases = collectCases(tests);
            includedCount += cases.length;
            return { file, cases };
        }).filter(({ cases }) => cases.length > 0);

        describe.each(suites)("$file", ({ cases }) => {
            it.each(cases)("%s", (_description, { input, expected, mode }) => {
                const decode =
                    mode === DecodingMode.Attribute
                        ? decodeHTMLAttribute
                        : decodeHTML;
                expect(decode(input)).toBe(expected);
                expect(decodeStreaming(input, mode)).toBe(expected);
            });
        });

        it("should not have filtered out most tests", () => {
            expect(includedCount).toBeGreaterThanOrEqual(
                MINIMUM_INCLUDED_TESTS,
            );
        });
    });
    // oxlint-disable-next-line node/no-process-env, vitest/no-conditional-tests -- CI requires the fixtures, while local checkouts may omit the submodule.
} else if (process.env["CI"]) {
    throw new Error(
        "html5lib-tests fixtures are missing. Run `git submodule update --init` to fetch them.",
    );
} else {
    // oxlint-disable-next-line no-console -- Tell local contributors how to fetch the missing fixtures.
    console.warn(
        "Skipping html5lib-tests fixtures: submodule not initialized. Run `git submodule update --init` to enable them.",
    );
    // oxlint-disable-next-line vitest/no-disabled-tests, vitest/prefer-todo -- The tests are implemented and run as soon as a local checkout has the fixture submodule.
    it.skip("html5lib-tests submodule not initialized");
}
