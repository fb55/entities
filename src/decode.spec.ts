import { beforeEach, describe, expect, it, vi } from "vitest";
import entityMap from "../maps/entities.json" with { type: "json" };
import html4Names from "../maps/html4.json" with { type: "json" };
import legacyMap from "../maps/legacy.json" with { type: "json" };
import xmlMap from "../maps/xml.json" with { type: "json" };
import * as entities from "./decode.js";

/**
 * Build a decode implementation backed by EntityDecoder, feeding entity
 * bodies in chunks of the given size (Infinity = all at once, 1 = char-by-char).
 * @param chunkSize Number of characters per write call.
 */
function makeStreamingImpl(chunkSize: number) {
    function decode(
        input: string,
        decodeTree: Uint16Array,
        decodeMode: entities.DecodingMode,
    ): string {
        let result = "";
        const decoder = new entities.EntityDecoder(
            decodeTree,
            (cp) => (result += String.fromCodePoint(cp)),
        );

        let lastIndex = 0;
        let offset = 0;

        while ((offset = input.indexOf("&", offset)) >= 0) {
            result += input.slice(lastIndex, offset);
            decoder.startEntity(decodeMode);

            const entityStart = offset + 1;
            let length: number;

            // eslint-disable-next-line unicorn/prefer-global-number-constants -- biome's useNumberNamespace enforces `Number.POSITIVE_INFINITY`
            if (chunkSize === Number.POSITIVE_INFINITY) {
                length = decoder.write(input, entityStart);
            } else {
                length = -1;
                for (
                    let pos = entityStart;
                    pos < input.length && length < 0;
                    pos += chunkSize
                ) {
                    length = decoder.write(
                        input.slice(pos, pos + chunkSize),
                        0,
                    );
                }
            }

            if (length < 0) {
                lastIndex = offset + decoder.end();
                break;
            }

            lastIndex = offset + length;
            offset = length === 0 ? lastIndex + 1 : lastIndex;
        }

        const out = result + input.slice(lastIndex);
        result = "";
        return out;
    }

    return {
        decodeHTML: (input: string, mode = entities.DecodingMode.Legacy) =>
            decode(input, entities.htmlDecodeTree, mode),
        decodeHTMLStrict: (input: string) =>
            decode(
                input,
                entities.htmlDecodeTree,
                entities.DecodingMode.Strict,
            ),
        decodeHTMLAttribute: (input: string) =>
            decode(
                input,
                entities.htmlDecodeTree,
                entities.DecodingMode.Attribute,
            ),
        decodeXML: (input: string) =>
            decode(input, entities.xmlDecodeTree, entities.DecodingMode.Strict),
    };
}

type DecoderImpl = ReturnType<typeof makeStreamingImpl>;

const syncImpl: DecoderImpl = {
    decodeHTML: entities.decodeHTML,
    decodeHTMLStrict: entities.decodeHTMLStrict,
    decodeHTMLAttribute: entities.decodeHTMLAttribute,
    decodeXML: entities.decodeXML,
};

const implementations: [string, DecoderImpl][] = [
    ["sync", syncImpl],
    // eslint-disable-next-line unicorn/prefer-global-number-constants -- biome's useNumberNamespace enforces `Number.POSITIVE_INFINITY`
    ["streaming (all at once)", makeStreamingImpl(Number.POSITIVE_INFINITY)],
    ["streaming (char-by-char)", makeStreamingImpl(1)],
];

describe.each(implementations)("Decode test: %s", (_name, {
    decodeHTML,
    decodeHTMLStrict,
    decodeHTMLAttribute,
    decodeXML,
}) => {
    /*
     * Cases where XML and HTML decoders agree. Run through both
     * `decodeXML` (fast path) and `decodeHTML` (trie). Adding `&lt;`,
     * `&gt;`, `&quot;`, `&apos;` here gives direct coverage of the
     * decodeXML switch arms — a typo there would otherwise slip through.
     */
    const sharedTestcases = [
        { input: "&amp;amp;", output: "&amp;" },
        { input: "&amp;#38;", output: "&#38;" },
        { input: "&amp;#x26;", output: "&#x26;" },
        { input: "&amp;#X26;", output: "&#X26;" },
        { input: "&#38;#38;", output: "&#38;" },
        { input: "&#x26;#38;", output: "&#38;" },
        { input: "&#X26;#38;", output: "&#38;" },
        { input: "&#x3a;", output: ":" },
        { input: "&#x3A;", output: ":" },
        { input: "&#X3a;", output: ":" },
        { input: "&#X3A;", output: ":" },
        { input: "&#", output: "&#" },
        { input: "&>", output: "&>" },
        { input: "id=770&#anchor", output: "id=770&#anchor" },
        { input: "&lt;", output: "<" },
        { input: "&gt;", output: ">" },
        { input: "&quot;", output: '"' },
        { input: "&apos;", output: "'" },
    ];

    it.each(sharedTestcases)("should XML decode $input", ({ input, output }) =>
        expect(decodeXML(input)).toBe(output));
    it.each(sharedTestcases)("should HTML decode $input", ({ input, output }) =>
        expect(decodeHTML(input)).toBe(output));

    it("should HTML decode partial legacy entity", () => {
        expect(decodeHTMLStrict("&timesbar")).toBe("&timesbar");
        expect(decodeHTML("&timesbar")).toBe("×bar");
    });

    it("should HTML decode legacy entities according to spec", () =>
        expect(decodeHTML("?&image_uri=1&ℑ=2&image=3")).toBe(
            "?&image_uri=1&ℑ=2&image=3",
        ));

    it("should back out of legacy entities", () =>
        expect(decodeHTML("&ampa")).toBe("&a"));

    it("should not parse numeric entities in strict mode", () =>
        expect(decodeHTMLStrict("&#55")).toBe("&#55"));

    describe("numeric entities without semicolons (legacy mode)", () => {
        it("should decode decimal entity followed by non-digit", () =>
            expect(decodeHTML("&#65x")).toBe("Ax"));

        it("should decode hex entity followed by non-hex", () =>
            expect(decodeHTML("&#x41x")).toBe("Ax"));

        it("should decode decimal entity at end of input", () =>
            expect(decodeHTML("&#65")).toBe("A"));

        it("should reject decimal entity without semicolon in strict mode", () =>
            expect(decodeHTMLStrict("&#65x")).toBe("&#65x"));

        it("should reject decimal entity at end of input in strict mode", () =>
            expect(decodeHTMLStrict("&#65")).toBe("&#65"));

        it("should map numeric values past U+10FFFF to U+FFFD", () => {
            /*
             * Sanity: max valid Unicode value passes through, exactly past
             * max (U+110000) maps to U+FFFD, and a large overflow that —
             * before the codepoint clamp — would truncate inside the
             * 21-bit packed-return field and emit a valid-looking
             * private-use char (U+100000) instead.
             */
            expect(decodeHTML("&#1114111;")).toBe("\u{10FFFF}");
            expect(decodeHTML("&#1114112;")).toBe("�");
            expect(decodeHTML("&#3145728;")).toBe("�");
            expect(decodeHTML("&#x300000;")).toBe("�");
        });
    });

    describe("overlong numeric entities (packed consumed-field overflow)", () => {
        /*
         * The sync `parseNumericEntity` packs `(consumed << 21) | cp`;
         * entities of ≥ 2047 characters exceed the 11-bit consumed field
         * and take the `longNumericConsumed` side channel. Whatever the
         * body length, the whole entity must be consumed and produce
         * U+FFFD (matching entities@7.0.1) — a wrapped consumed count
         * would leak digits into the output.
         */
        const digitCounts = [2045, 2046, 2047, 2048, 4096];
        const bases: [string, string][] = [
            ["decimal", ""],
            ["hex", "x"],
        ];

        describe.each(bases)("%s", (_base, prefix) => {
            it.each(
                digitCounts,
            )("should decode a %i-digit body with semicolon", (count) => {
                const input = `&#${prefix}${"1".repeat(count)};X`;
                expect(decodeHTML(input)).toBe("�X");
                expect(decodeHTMLStrict(input)).toBe("�X");
                expect(decodeHTMLAttribute(input)).toBe("�X");
                expect(decodeXML(input)).toBe("�X");
            });

            it.each(
                digitCounts,
            )("should decode a %i-digit body without semicolon", (count) => {
                const input = `&#${prefix}${"1".repeat(count)}X`;
                expect(decodeHTML(input)).toBe("�X");
                expect(decodeHTMLAttribute(input)).toBe("�X");
                // Strict modes require the semicolon.
                expect(decodeHTMLStrict(input)).toBe(input);
                expect(decodeXML(input)).toBe(input);
            });

            it.each(
                digitCounts,
            )("should decode a %i-digit body at the end of input", (count) => {
                const input = `&#${prefix}${"1".repeat(count)}`;
                expect(decodeHTML(input)).toBe("�");
                expect(decodeHTMLStrict(input)).toBe(input);
            });
        });

        it("should recover the exact code point after thousands of leading zeros", () => {
            expect(decodeHTML(`&#${"0".repeat(2048)}65;X`)).toBe("AX");
            expect(decodeXML(`&#x${"0".repeat(2048)}41;X`)).toBe("AX");
        });
    });

    it("should parse &nbsp followed by < (#852)", () =>
        expect(decodeHTML("&nbsp<")).toBe("\u{A0}<"));

    it("should decode trailing legacy entities", () => {
        expect(decodeHTML("&timesbar;&timesbar")).toBe("⨱×bar");
    });

    it("should decode multi-byte entities", () => {
        expect(decodeHTML("&NotGreaterFullEqual;")).toBe("≧̸");
    });

    describe("attribute mode", () => {
        /*
         * Inputs that should be left verbatim in attribute mode. Covers the
         * four legacy-fallback paths in `stateNamedEntity`:
         *   - alpha / digit / `=` immediately after the legacy match
         *   - branch miss after descending past it (#2208)
         *   - compact-run mismatch after descending past it
         */
        const rejectCases = [
            { input: "&notp" },
            { input: "&notP" },
            { input: "&not3" },
            { input: "&noti" },
            { input: "&not=" },
            { input: "&notin\0;" },
            { input: "&notin<" },
            // Compact-run middle-char mismatch
            { input: "&ltlaXr;" },
            // Compact-run first-char mismatch
            { input: "&ltlXarr;" },
        ];

        it.each(rejectCases)("should not decode $input", ({ input }) =>
            expect(decodeHTMLAttribute(input)).toBe(input));

        /*
         * Accept cases:
         *   - standalone legacy match (no descent / EOF)
         *   - semicolon-terminated entities ignore the following char
         *   - numeric entities are always accepted
         *   - leaf-node legacy match (e.g. `amp`) followed by a char that
         *     isn't an invalid attribute terminator. The trailing char
         *     equals the entity's value byte — the decoder must not read
         *     the value slot as a trie node and descend into it.
         */
        const acceptCases = [
            { input: "&not", output: "¬" },
            { input: "&amp;x", output: "&x" },
            { input: "&lt;x", output: "<x" },
            { input: "&amp;=", output: "&=" },
            { input: "&#65;x", output: "Ax" },
            { input: "&#x41;x", output: "Ax" },
            { input: "&#65x", output: "Ax" },
            { input: "&#x41x", output: "Ax" },
            { input: "&amp&", output: "&&" },
            { input: "&amp&x", output: "&&x" },
            { input: "&lt<", output: "<<" },
            { input: "&gt>", output: ">>" },
        ];

        it.each(acceptCases)("should decode $input → $output", ({
            input,
            output,
        }) => expect(decodeHTMLAttribute(input)).toBe(output));
    });

    describe("full entity maps (regression guard for trie generation)", () => {
        it("should decode every named entity from the WHATWG map", () => {
            for (const [name, value] of Object.entries(entityMap)) {
                expect(decodeHTML(`&${name};`)).toBe(value);
                expect(decodeHTMLStrict(`&${name};`)).toBe(value);
            }
        });

        it("should decode every XML entity", () => {
            for (const [name, value] of Object.entries(xmlMap)) {
                expect(decodeXML(`&${name};`)).toBe(value);
            }
        });

        /*
         * Covers the streaming `consumed` bookkeeping for entities ending in
         * compact trie runs: a wrong consumed count makes the streaming
         * implementations drop or duplicate characters around the entity.
         */
        it("should decode every legacy entity without a semicolon", () => {
            for (const [name, value] of Object.entries(legacyMap)) {
                expect(decodeHTML(`&${name}`)).toBe(value);
                expect(decodeHTML(`&${name} after`)).toBe(`${value} after`);
                expect(decodeHTML(`x&${name}-y`)).toBe(`x${value}-y`);
            }
        });
    });

    describe("non-entities with legacy-like prefixes stay literal", () => {
        /*
         * In entities <= 7.0.1, a failed named-entity match could read the
         * legacy result from a wrong trie index, emitting an unrelated
         * character (e.g. `&Gdot ` → `Â`). These inputs must stay literal.
         */
        const literalCases = [
            "&Gdot ",
            "&eta=",
            "&Ocy ",
            "&YUcy1",
            "&backepsilonx",
            "&bepsix",
        ];

        it.each(literalCases)("should not decode %j", (input) => {
            expect(decodeHTML(input)).toBe(input);
            expect(decodeHTMLStrict(input)).toBe(input);
            expect(decodeHTMLAttribute(input)).toBe(input);
        });

        /*
         * Legacy prefixes of longer names decode in text mode but must stay
         * literal in attribute mode (next char is alphanumeric).
         */
        const prefixCases = [
            { input: "&centerdot ", text: "¢erdot " },
            { input: "&copysr ", text: "©sr " },
            { input: "&divideontimes ", text: "÷ontimes " },
            { input: "&gtcc ", text: ">cc " },
        ];

        it.each(
            prefixCases,
        )("should decode $input as legacy prefix only in text mode", ({
            input,
            text,
        }) => {
            expect(decodeHTML(input)).toBe(text);
            expect(decodeHTMLAttribute(input)).toBe(input);
        });
    });
});

/*
 * `maps/html4.json` drives the hot/cold trie-encoding split in
 * `scripts/write-decode-map.ts`: names listed there keep the fast jump-table
 * encoding. A name that is duplicated (wasted hot budget) or missing from the
 * WHATWG map (silently ignored when marking hot paths) would degrade the
 * generated trie without failing the build.
 */
describe("entity map contracts", () => {
    it("html4.json should be duplicate-free", () => {
        const duplicates = html4Names.filter(
            (name, index) => html4Names.indexOf(name) !== index,
        );
        expect(duplicates).toStrictEqual([]);
    });

    it("every html4.json name should be a key in entities.json", () => {
        const missing = html4Names.filter(
            (name) => !Object.hasOwn(entityMap, name),
        );
        expect(missing).toStrictEqual([]);
    });
});

describe("EntityDecoder", () => {
    let callback: ReturnType<
        typeof vi.fn<(cp: number, consumed: number) => void>
    >;
    let decoder: entities.EntityDecoder;

    beforeEach(() => {
        callback = vi.fn<(cp: number, consumed: number) => void>();
        decoder = new entities.EntityDecoder(entities.htmlDecodeTree, callback);
    });

    it("should decode decimal entities", () => {
        expect(decoder.write("&#5", 1)).toBe(-1);
        expect(decoder.write("8;", 0)).toBe(5);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(":".charCodeAt(0), 5);
    });

    it("should decode hex entities", () => {
        expect(decoder.write("&#x3a;", 1)).toBe(6);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(":".charCodeAt(0), 6);
    });

    it("should decode named entities", () => {
        expect(decoder.write("&amp;", 1)).toBe(5);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith("&".charCodeAt(0), 5);
    });

    it("should decode legacy entities", () => {
        decoder.startEntity(entities.DecodingMode.Legacy);

        expect(decoder.write("&amp", 1)).toBe(-1);

        expect(callback).toHaveBeenCalledTimes(0);

        expect(decoder.end()).toBe(4);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith("&".charCodeAt(0), 4);
    });

    it("should decode named entity written character by character", () => {
        for (const c of "amp") {
            expect(decoder.write(c, 0)).toBe(-1);
        }
        expect(decoder.write(";", 0)).toBe(5);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith("&".charCodeAt(0), 5);
    });

    it("should decode numeric entity written character by character", () => {
        for (const c of "#x3a") {
            expect(decoder.write(c, 0)).toBe(-1);
        }
        expect(decoder.write(";", 0)).toBe(6);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(":".charCodeAt(0), 6);
    });

    it("should decode hex entities across several chunks", () => {
        for (const chunk of ["#x", "cf", "ff", "d"]) {
            expect(decoder.write(chunk, 0)).toBe(-1);
        }

        expect(decoder.write(";", 0)).toBe(9);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(0xc_ff_fd, 9);
    });

    it("should not fail if nothing is written", () => {
        expect(decoder.end()).toBe(0);
        expect(callback).toHaveBeenCalledTimes(0);
    });

    it("should not commit a legacy match in attribute mode after descending past it (#2208)", () => {
        decoder.startEntity(entities.DecodingMode.Attribute);
        expect(decoder.write("notin\0;", 0)).toBe(0);
        expect(decoder.end()).toBe(0);
        expect(callback).not.toHaveBeenCalled();
    });

    it("should not commit a legacy match in attribute mode after descending past it across chunks (#2208)", () => {
        decoder.startEntity(entities.DecodingMode.Attribute);
        for (const chunk of ["no", "ti", "n\0", ";"]) {
            const written = decoder.write(chunk, 0);
            expect(written).toBeLessThanOrEqual(0);
        }
        expect(decoder.end()).toBe(0);
        expect(callback).not.toHaveBeenCalled();
    });

    /*
     * Focused tests exercising early exit paths inside a compact run in the real trie.
     * Discovered prefix: "zi" followed by compact run "grarr"; mismatching inside this run should
     * return 0 with no emission (result still 0).
     */
    describe("overlong numeric entities", () => {
        /*
         * The streaming decoder tracks `consumed` as a plain field, so —
         * unlike the sync parser's packed return value — no length ever
         * overflows. These pin the equivalence for the sync boundary cases.
         */
        const digitCounts = [2045, 2046, 2047, 2048, 4096];

        it.each(
            digitCounts,
        )("should report full consumed for %i decimal digits", (count) => {
            decoder.startEntity(entities.DecodingMode.Strict);
            expect(decoder.write(`&#${"1".repeat(count)};`, 1)).toBe(count + 3);
            expect(callback).toHaveBeenCalledExactlyOnceWith(
                0xff_fd,
                count + 3,
            );
        });

        it.each(
            digitCounts,
        )("should report full consumed for %i hex digits", (count) => {
            decoder.startEntity(entities.DecodingMode.Strict);
            expect(decoder.write(`&#x${"1".repeat(count)};`, 1)).toBe(
                count + 4,
            );
            expect(callback).toHaveBeenCalledExactlyOnceWith(
                0xff_fd,
                count + 4,
            );
        });

        it("should clamp the accumulator before it reaches the errors callbacks", () => {
            const errorHandlers = {
                missingSemicolonAfterCharacterReference: vi.fn(),
                absenceOfDigitsInNumericCharacterReference: vi.fn(),
                validateNumericCharacterReference: vi.fn(),
            };
            const errorDecoder = new entities.EntityDecoder(
                entities.htmlDecodeTree,
                callback,
                errorHandlers,
            );
            errorDecoder.startEntity(entities.DecodingMode.Strict);
            errorDecoder.write(`&#x${"f".repeat(4096)};`, 1);
            expect(
                errorHandlers.validateNumericCharacterReference,
            ).toHaveBeenCalledExactlyOnceWith(0x11_00_00);
        });
    });

    describe("compact run mismatches", () => {
        it.each([
            ["first run character mismatch", "ziXgrar"],
            ["mismatch after one correct run char", "zigXarr"],
            ["mismatch after two correct run chars", "zigrXrr"],
        ])("%s returns 0", (_name, input) => {
            const callback = vi.fn<(cp: number, consumed: number) => void>();
            const d = new entities.EntityDecoder(
                entities.htmlDecodeTree,
                callback,
            );
            d.startEntity(entities.DecodingMode.Strict);
            expect(d.write(input, 0)).toBe(0);
            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe("errors", () => {
        const errorHandlers = {
            missingSemicolonAfterCharacterReference: vi.fn(),
            absenceOfDigitsInNumericCharacterReference: vi.fn(),
            validateNumericCharacterReference: vi.fn(),
        };

        beforeEach(() => {
            errorHandlers.missingSemicolonAfterCharacterReference.mockClear();
            errorHandlers.absenceOfDigitsInNumericCharacterReference.mockClear();
            errorHandlers.validateNumericCharacterReference.mockClear();
            callback = vi.fn<(cp: number, consumed: number) => void>();
            decoder = new entities.EntityDecoder(
                entities.htmlDecodeTree,
                callback,
                errorHandlers,
            );
            decoder.startEntity(entities.DecodingMode.Legacy);
        });

        it("should produce an error for a named entity without a semicolon", () => {
            expect(decoder.write("&amp;", 1)).toBe(5);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith("&".charCodeAt(0), 5);
            expect(
                errorHandlers.missingSemicolonAfterCharacterReference,
            ).toHaveBeenCalledTimes(0);

            decoder.startEntity(entities.DecodingMode.Legacy);
            expect(decoder.write("&amp", 1)).toBe(-1);
            expect(decoder.end()).toBe(4);

            expect(callback).toHaveBeenCalledTimes(2);
            expect(callback).toHaveBeenLastCalledWith("&".charCodeAt(0), 4);
            expect(
                errorHandlers.missingSemicolonAfterCharacterReference,
            ).toHaveBeenCalledTimes(1);
        });

        it("should produce an error for a numeric entity without a semicolon", () => {
            expect(decoder.write("&#x3a", 1)).toBe(-1);
            expect(decoder.end()).toBe(5);

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(0x3a, 5);
            expect(
                errorHandlers.missingSemicolonAfterCharacterReference,
            ).toHaveBeenCalledTimes(1);
            expect(
                errorHandlers.absenceOfDigitsInNumericCharacterReference,
            ).toHaveBeenCalledTimes(0);
            expect(
                errorHandlers.validateNumericCharacterReference,
            ).toHaveBeenCalledTimes(1);
            expect(
                errorHandlers.validateNumericCharacterReference,
            ).toHaveBeenCalledWith(0x3a);
        });

        it("should produce an error for numeric entities without digits", () => {
            expect(decoder.write("&#", 1)).toBe(-1);
            expect(decoder.end()).toBe(0);

            expect(callback).toHaveBeenCalledTimes(0);
            expect(
                errorHandlers.missingSemicolonAfterCharacterReference,
            ).toHaveBeenCalledTimes(0);
            expect(
                errorHandlers.absenceOfDigitsInNumericCharacterReference,
            ).toHaveBeenCalledTimes(1);
            expect(
                errorHandlers.absenceOfDigitsInNumericCharacterReference,
            ).toHaveBeenCalledWith(2);
            expect(
                errorHandlers.validateNumericCharacterReference,
            ).toHaveBeenCalledTimes(0);
        });

        it("should produce an error for hex entities without digits", () => {
            expect(decoder.write("&#x", 1)).toBe(-1);
            expect(decoder.end()).toBe(0);

            expect(callback).toHaveBeenCalledTimes(0);
            expect(
                errorHandlers.missingSemicolonAfterCharacterReference,
            ).toHaveBeenCalledTimes(0);
            expect(
                errorHandlers.absenceOfDigitsInNumericCharacterReference,
            ).toHaveBeenCalledTimes(1);
            expect(
                errorHandlers.validateNumericCharacterReference,
            ).toHaveBeenCalledTimes(0);
        });
    });
});
