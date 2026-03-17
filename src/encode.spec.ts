import { describe, expect, it } from "vitest";
import * as entities from "./index.js";

describe("Encode->decode test", () => {
    const testcases = [
        {
            input: "asdf & ÿ ü '",
            xml: "asdf &amp; &#xff; &#xfc; &apos;",
            html: "asdf &amp; &yuml; &uuml; &apos;",
        },
        {
            input: "&#38;",
            xml: "&amp;#38;",
            html: "&amp;&num;38&semi;",
        },
    ];

    for (const { input, xml, html } of testcases) {
        const encodedXML = entities.encodeXML(input);
        it(`should XML encode ${input}`, () => expect(encodedXML).toBe(xml));
        it(`should default to XML encode ${input}`, () =>
            expect(entities.encode(input)).toBe(xml));
        it(`should XML decode ${encodedXML}`, () =>
            expect(entities.decodeXML(encodedXML)).toBe(input));
        it(`should default to XML encode ${encodedXML}`, () =>
            expect(entities.decode(encodedXML)).toBe(input));
        it(`should default strict to XML encode ${encodedXML}`, () =>
            expect(
                entities.decode(encodedXML, {
                    mode: entities.DecodingMode.Strict,
                }),
            ).toBe(input));

        const encodedHTML = entities.encodeHTML(input);
        it(`should HTML encode ${input}`, () =>
            expect(encodedHTML).toBe(html));
        it(`should HTML decode ${encodedHTML}`, () =>
            expect(entities.decodeHTML(encodedHTML)).toBe(input));
        it("should encode emojis", () =>
            expect(entities.encodeHTML("😄🍾🥳💥😇")).toBe(
                "&#x1f604;&#x1f37e;&#x1f973;&#x1f4a5;&#x1f607;",
            ));
    }

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
        expect(entities.encodeHTML("\uD835")).toBe("&#xd835;"));

    it("should encode surrogate pair with first surrogate equivalent of entity, without corresponding entity", () =>
        expect(entities.encodeHTML("\u{1D4A4}")).toBe("&#x1d4a4;"));
});

describe("encodeNonAsciiHTML", () => {
    it("should encode all non-ASCII characters", () =>
        expect(entities.encodeNonAsciiHTML("<test> #123! übermaßen")).toBe(
            "&lt;test&gt; #123! &uuml;berma&szlig;en",
        ));

    it("should encode emojis", () =>
        expect(entities.encodeNonAsciiHTML("😄🍾🥳💥😇")).toBe(
            "&#x1f604;&#x1f37e;&#x1f973;&#x1f4a5;&#x1f607;",
        ));

    it("should encode chars above surrogates", () =>
        expect(entities.encodeNonAsciiHTML("♒️♓️♈️♉️♊️♋️♌️♍️♎️♏️♐️♑️")).toBe(
            "&#x2652;&#xfe0f;&#x2653;&#xfe0f;&#x2648;&#xfe0f;&#x2649;&#xfe0f;&#x264a;&#xfe0f;&#x264b;&#xfe0f;&#x264c;&#xfe0f;&#x264d;&#xfe0f;&#x264e;&#xfe0f;&#x264f;&#xfe0f;&#x2650;&#xfe0f;&#x2651;&#xfe0f;",
        ));
});
