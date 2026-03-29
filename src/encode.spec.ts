import { describe, expect, it } from "vitest";
import * as entities from "./index.js";

describe("Encode->decode test", () => {
    const testcases = [
        {
            input: "asdf & ÿ ü '",
            xml: "asdf &amp; &#255; &#252; &apos;",
            html: "asdf &amp; &yuml; &uuml; &apos;",
        },
        {
            input: "&#38;",
            xml: "&amp;#38;",
            html: "&amp;&num;38&semi;",
        },
    ];

    it.each(testcases)("should XML encode $input", ({ input, xml }) =>
        expect(entities.encodeXML(input)).toBe(xml));
    it.each(testcases)("should default to XML encode $input", ({
        input,
        xml,
    }) => expect(entities.encode(input)).toBe(xml));
    it.each(testcases)("should XML decode $xml", ({ input, xml }) =>
        expect(entities.decodeXML(xml)).toBe(input));
    it.each(testcases)("should default to XML decode $xml", ({ input, xml }) =>
        expect(entities.decode(xml)).toBe(input));
    it.each(testcases)("should default strict to XML decode $xml", ({
        input,
        xml,
    }) =>
        expect(
            entities.decode(xml, { mode: entities.DecodingMode.Strict }),
        ).toBe(input));
    it.each(testcases)("should HTML encode $input", ({ input, html }) =>
        expect(entities.encodeHTML(input)).toBe(html));
    it.each(testcases)("should HTML decode $html", ({ input, html }) =>
        expect(entities.decodeHTML(html)).toBe(input));

    it("should encode emojis", () =>
        expect(entities.encodeHTML("😄🍾🥳💥😇")).toBe(
            "&#128516;&#127870;&#129395;&#128165;&#128519;",
        ));

    it("should encode data URIs (issue #16)", () => {
        const data =
            "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAALAAABAAEAAAIBRAA7";
        expect(entities.decode(entities.encode(data))).toBe(data);
    });

    it("should HTML encode all ASCII characters", () => {
        for (let index = 0; index < 128; index++) {
            const char = String.fromCharCode(index);
            const encoded = entities.encodeHTML(char);
            const decoded = entities.decodeHTML(encoded);
            expect(decoded).toBe(char);
        }
    });

    it("should encode trailing parts of entities", () =>
        expect(entities.encodeHTML("\uD835")).toBe("&#55349;"));

    it("should encode surrogate pair with first surrogate equivalent of entity, without corresponding entity", () =>
        expect(entities.encodeHTML("\u{1D4A4}")).toBe("&#119972;"));
});

describe("encodeNonAsciiHTML", () => {
    it("should encode all non-ASCII characters", () =>
        expect(entities.encodeNonAsciiHTML("<test> #123! übermaßen")).toBe(
            "&lt;test&gt; #123! &uuml;berma&szlig;en",
        ));

    it("should encode emojis", () =>
        expect(entities.encodeNonAsciiHTML("😄🍾🥳💥😇")).toBe(
            "&#128516;&#127870;&#129395;&#128165;&#128519;",
        ));

    it("should encode chars above surrogates", () =>
        expect(entities.encodeNonAsciiHTML("♒️♓️♈️♉️♊️♋️♌️♍️♎️♏️♐️♑️")).toBe(
            "&#9810;&#65039;&#9811;&#65039;&#9800;&#65039;&#9801;&#65039;&#9802;&#65039;&#9803;&#65039;&#9804;&#65039;&#9805;&#65039;&#9806;&#65039;&#9807;&#65039;&#9808;&#65039;&#9809;&#65039;",
        ));
});
