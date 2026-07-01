// eslint-disable-next-line unicorn/name-replacements -- html5lib is the proper name of the upstream test suite.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    DecodingMode,
    decodeHTML,
    decodeHTMLAttribute,
    EntityDecoder,
} from "./decode.js";
import { htmlDecodeTree } from "./generated/decode-data-html.js";

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
 *    a streaming `EntityDecoder` fed one character per chunk.
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
const ATTRIBUTE_TEMPLATE = /^<h a=(["']?)(.*)\1>$/s;

/**
 * Guards against a submodule update silently causing the filter to exclude
 * everything. As of html5lib-tests 224991e the filter includes 4626 tests.
 */
const MINIMUM_INCLUDED_TESTS = 4000;

/**
 * Decodes a string by feeding an `EntityDecoder` one character per chunk,
 * exercising the streaming state machine across chunk boundaries.
 * @param input The string to decode.
 * @param mode The decoding mode to use for each entity.
 * @returns The decoded string.
 */
function decodeStreaming(input: string, mode: DecodingMode): string {
    let result = "";
    const decoder = new EntityDecoder(htmlDecodeTree, (codePoint) => {
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

interface FixtureCase {
    description: string;
    run: () => void;
}

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
            test.doubleEscaped ? (JSON.parse(`"${value}"`) as string) : value;
        const input = unescape(test.input);

        if (
            test.output.every(([type]) => type === "Character") &&
            !input.includes("<") &&
            !input.includes("\r")
        ) {
            const expected = test.output
                .map(([, data]) => unescape(data as string))
                .join("");

            cases.push({
                description: test.description,
                run: () => {
                    expect(decodeHTML(input)).toBe(expected);
                    expect(decodeStreaming(input, DecodingMode.Legacy)).toBe(
                        expected,
                    );
                },
            });
        } else if (
            test.output.length === 1 &&
            test.output[0][0] === "StartTag"
        ) {
            const match = ATTRIBUTE_TEMPLATE.exec(input);
            const attributes = test.output[0][2] as Record<string, string>;
            if (
                match &&
                test.output[0][1] === "h" &&
                Object.keys(attributes).length === 1 &&
                "a" in attributes
            ) {
                const attributeValue = match[2];
                const expected = unescape(attributes["a"]);

                cases.push({
                    description: test.description,
                    run: () => {
                        expect(decodeHTMLAttribute(attributeValue)).toBe(
                            expected,
                        );
                        expect(
                            decodeStreaming(
                                attributeValue,
                                DecodingMode.Attribute,
                            ),
                        ).toBe(expected);
                    },
                });
            }
        }
    }

    return cases;
}

if (existsSync(fixtureDirectory)) {
    describe("html5lib-tests tokenizer entity fixtures", () => {
        let includedCount = 0;

        for (const file of FIXTURE_FILES) {
            const { tests } = JSON.parse(
                readFileSync(new URL(`${file}.test`, fixtureDirectory), "utf8"),
            ) as { tests: TokenizerTest[] };

            const cases = collectCases(tests);
            includedCount += cases.length;

            if (cases.length > 0) {
                describe(file, () => {
                    for (const { description, run } of cases) {
                        it(description, run);
                    }
                });
            }
        }

        it("should not have filtered out most tests", () => {
            expect(includedCount).toBeGreaterThanOrEqual(
                MINIMUM_INCLUDED_TESTS,
            );
        });
    });
} else if (process.env["CI"]) {
    throw new Error(
        "html5lib-tests fixtures are missing. Run `git submodule update --init` to fetch them.",
    );
} else {
    console.warn(
        "Skipping html5lib-tests fixtures: submodule not initialized. Run `git submodule update --init` to enable them.",
    );
    it.skip("html5lib-tests submodule not initialized", () => {
        // Skipped: fixtures are unavailable.
    });
}
