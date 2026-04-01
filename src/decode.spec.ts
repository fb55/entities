import { beforeEach, describe, expect, it, vi } from "vitest";
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
    ["streaming (all at once)", makeStreamingImpl(Number.POSITIVE_INFINITY)],
    ["streaming (char-by-char)", makeStreamingImpl(1)],
];

describe.each(implementations)("Decode test: %s", (_name, {
    decodeHTML,
    decodeHTMLStrict,
    decodeHTMLAttribute,
    decodeXML,
}) => {
    const testcases = [
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
    ];

    it.each(testcases)("should XML decode $input", ({ input, output }) =>
        expect(decodeXML(input)).toBe(output));
    it.each(testcases)("should HTML decode $input", ({ input, output }) =>
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
    });

    it("should parse &nbsp followed by < (#852)", () =>
        expect(decodeHTML("&nbsp<")).toBe("\u00A0<"));

    it("should decode trailing legacy entities", () => {
        expect(decodeHTML("&timesbar;&timesbar")).toBe("⨱×bar");
    });

    it("should decode multi-byte entities", () => {
        expect(decodeHTML("&NotGreaterFullEqual;")).toBe("≧̸");
    });

    it("should not decode legacy entities followed by text in attribute mode", () => {
        expect(decodeHTML("&not", entities.DecodingMode.Attribute)).toBe("¬");

        expect(decodeHTML("&noti", entities.DecodingMode.Attribute)).toBe(
            "&noti",
        );

        expect(decodeHTML("&not=", entities.DecodingMode.Attribute)).toBe(
            "&not=",
        );

        expect(decodeHTMLAttribute("&notp")).toBe("&notp");
        expect(decodeHTMLAttribute("&notP")).toBe("&notP");
        expect(decodeHTMLAttribute("&not3")).toBe("&not3");
    });

    it("should decode semicolon-terminated entities in attribute mode", () => {
        expect(decodeHTMLAttribute("&amp;x")).toBe("&x");
        expect(decodeHTMLAttribute("&lt;x")).toBe("<x");
        expect(decodeHTMLAttribute("&amp;=")).toBe("&=");
    });

    it("should decode numeric entities in attribute mode", () => {
        expect(decodeHTMLAttribute("&#65;x")).toBe("Ax");
        expect(decodeHTMLAttribute("&#x41;x")).toBe("Ax");
        expect(decodeHTMLAttribute("&#65x")).toBe("Ax");
        expect(decodeHTMLAttribute("&#x41x")).toBe("Ax");
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

    /*
     * Focused tests exercising early exit paths inside a compact run in the real trie.
     * Discovered prefix: "zi" followed by compact run "grarr"; mismatching inside this run should
     * return 0 with no emission (result still 0).
     */
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
