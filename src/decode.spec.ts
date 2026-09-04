import { beforeEach, describe, expect, it, vi } from "vitest";
import entityMap from "../maps/entities.json" with { type: "json" };
import legacyMap from "../maps/legacy.json" with { type: "json" };
import xmlMap from "../maps/xml.json" with { type: "json" };
import * as entities from "./decode.js";

/**
 * Build a decode implementation backed by the streaming decoders, feeding entity
 * bodies in chunks of the given size (Infinity = all at once, 1 = char-by-char).
 * @param chunkSize Number of characters per write call.
 */
function makeStreamingImpl(chunkSize: number) {
    function decode(
        input: string,
        documentType: "html" | "xml",
        decodeMode: entities.DecodingMode,
    ): string {
        let result = "";
        const decoder =
            documentType === "html"
                ? new entities.HtmlEntityDecoder(
                      (cp) => (result += String.fromCodePoint(cp)),
                  )
                : new entities.XmlEntityDecoder(
                      (cp) => (result += String.fromCodePoint(cp)),
                  );

        let lastIndex = 0;
        let offset = 0;

        while ((offset = input.indexOf("&", offset)) >= 0) {
            result += input.slice(lastIndex, offset);
            decoder.startEntity(decodeMode);

            const entityStart = offset + 1;
            let length: number;

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
            decode(input, "html", mode),
        decodeHTMLStrict: (input: string) =>
            decode(input, "html", entities.DecodingMode.Strict),
        decodeHTMLAttribute: (input: string) =>
            decode(input, "html", entities.DecodingMode.Attribute),
        decodeXML: (input: string) =>
            decode(input, "xml", entities.DecodingMode.Strict),
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
     * Cases where the XML and HTML decoders agree. Run through both
     * `decodeXML` and `decodeHTML` so the two implementations cover the
     * same inputs. Including `&lt;`, `&gt;`, `&quot;`, `&apos;` gives
     * direct coverage of the XML entity set.
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
             * before the codepoint clamp — would truncate to a valid-looking
             * private-use char (U+100000) instead.
             */
            expect(decodeHTML("&#1114111;")).toBe("\u{10FFFF}");
            expect(decodeHTML("&#1114112;")).toBe("�");
            expect(decodeHTML("&#3145728;")).toBe("�");
            expect(decodeHTML("&#x300000;")).toBe("�");
        });

        it("should decode numeric entities with very long digit runs", () => {
            /*
             * `consumed` is packed into the upper 11 bits of the parse result,
             * so references up to 2047 characters decode and advance exactly.
             */
            const zeros = "0".repeat(2000);
            expect(decodeHTML(`&#${zeros}65;`)).toBe("A");
            expect(decodeHTML(`&#x${zeros}41;`)).toBe("A");
            expect(decodeHTMLStrict(`&#${zeros}65;`)).toBe("A");
            expect(decodeXML(`&#${zeros}65;`)).toBe("A");
            // Legacy mode, no terminator.
            expect(decodeHTML(`&#${zeros}65`)).toBe("A");
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
         * Inputs that should be left verbatim in attribute mode: an
         * alphanumeric or `=` immediately after a legacy match rejects it,
         * including when the name continues past the match and only fails
         * to be a longer entity later (#2208).
         */
        const rejectCases = [
            { input: "&notp" },
            { input: "&notP" },
            { input: "&not3" },
            { input: "&noti" },
            { input: "&not=" },
            { input: "&notin\0;" },
            { input: "&notin<" },
            // Middle-character mismatch in a longer candidate name
            { input: "&ltlaXr;" },
            // Mismatch right after the legacy match
            { input: "&ltlXarr;" },
        ];

        it.each(rejectCases)("should not decode $input", ({ input }) =>
            expect(decodeHTMLAttribute(input)).toBe(input));

        /*
         * Accept cases:
         *   - standalone legacy match (end of input)
         *   - semicolon-terminated entities ignore the following char
         *   - numeric entities are always accepted
         *   - a legacy match (e.g. `amp`) followed by a char that isn't an
         *     invalid attribute terminator — including the tricky shape
         *     where the trailing char equals the entity's replacement
         *     character, which must not extend the match.
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

    describe("full entity maps (regression guard for data generation)", () => {
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
         * Covers the `consumed` bookkeeping for legacy matches: a wrong
         * count makes the streaming implementations drop or duplicate
         * characters around the entity.
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
         * In entities <= 7.0.1, a failed named-entity match could emit an
         * unrelated character from a misindexed legacy lookup (e.g.
         * `&Gdot ` → `Â`). These inputs must stay literal.
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

describe("numeric consumed-packing limit (sync decoders)", () => {
    /*
     * The sync decoders pack `consumed` into 11 bits; references whose
     * consumed count exceeds 2047 are rejected and stay literal — a packing
     * overflow here would emit the value and then re-emit the digits.
     * `&#<n zeros>65;` consumes n + 5 characters, so n === 2042 is the
     * longest terminated run that decodes. The streaming decoders have no
     * such packing and decode runs of any length exactly (covered by the
     * `describe.each` cases above via `makeStreamingImpl`).
     */
    it("should decode up to the limit and leave longer references literal", () => {
        const fits = `&#${"0".repeat(2042)}65`;
        expect(entities.decodeHTML(`${fits};`)).toBe("A");
        expect(entities.decodeHTMLStrict(`${fits};`)).toBe("A");
        expect(entities.decodeXML(`${fits};`)).toBe("A");
        expect(entities.decodeHTML(fits)).toBe("A");
        // Without the semicolon one more digit fits.
        expect(entities.decodeHTML(`&#${"0".repeat(2043)}65`)).toBe("A");
        for (let n = 2043; n <= 2050; n++) {
            const input = `&#${"0".repeat(n)}65;`;
            expect(entities.decodeHTML(input)).toBe(input);
            expect(entities.decodeHTMLStrict(input)).toBe(input);
            expect(entities.decodeXML(input)).toBe(input);
            if (n > 2043) {
                expect(entities.decodeHTML(input.slice(0, -1))).toBe(
                    input.slice(0, -1),
                );
            }
        }
    });

    it("should decode past the sync limit in the streaming decoder", () => {
        const streaming = makeStreamingImpl(Number.POSITIVE_INFINITY);
        expect(streaming.decodeHTML(`&#${"0".repeat(2048)}65;`)).toBe("A");
    });
});

describe("HtmlEntityDecoder", () => {
    let callback: ReturnType<
        typeof vi.fn<(cp: number, consumed: number) => void>
    >;
    let decoder: entities.HtmlEntityDecoder;

    beforeEach(() => {
        callback = vi.fn<(cp: number, consumed: number) => void>();
        decoder = new entities.HtmlEntityDecoder(callback);
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

    it("should not commit a legacy match in attribute mode when the name continues past it (#2208)", () => {
        decoder.startEntity(entities.DecodingMode.Attribute);
        expect(decoder.write("notin\0;", 0)).toBe(0);
        expect(decoder.end()).toBe(0);
        expect(callback).not.toHaveBeenCalled();
    });

    it("should not commit a legacy match in attribute mode when the name continues past it across chunks (#2208)", () => {
        decoder.startEntity(entities.DecodingMode.Attribute);
        for (const chunk of ["no", "ti", "n\0", ";"]) {
            const written = decoder.write(chunk, 0);
            expect(written).toBeLessThanOrEqual(0);
        }
        expect(decoder.end()).toBe(0);
        expect(callback).not.toHaveBeenCalled();
    });

    /*
     * Mismatches inside a name must reject without emitting. The decoder
     * may buffer (-1) until the run's terminator makes the rejection
     * conclusive; the final outcome is 0 with no emission.
     */
    describe("name mismatches", () => {
        it.each([
            ["first run character mismatch", "ziXgrar"],
            ["mismatch after one correct run char", "zigXarr"],
            ["mismatch after two correct run chars", "zigrXrr"],
        ])("%s rejects without emitting", (_name, input) => {
            const callback = vi.fn<(cp: number, consumed: number) => void>();
            const d = new entities.HtmlEntityDecoder(callback);
            d.startEntity(entities.DecodingMode.Strict);
            const written = d.write(input, 0);
            expect(written).toBeLessThanOrEqual(0);
            if (written === -1) expect(d.end()).toBe(0);
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
            decoder = new entities.HtmlEntityDecoder(callback, errorHandlers);
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
