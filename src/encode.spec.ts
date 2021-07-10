import * as entities from ".";

describe("Encode->decode test", () => {
    const testcases = [
        {
            input: "asdf & ÿ ü '",
            xml: "asdf &amp; &#xFF; &#xFC; &apos;",
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
            expect(entities.decodeStrict(encodedXML)).toBe(input));

        const encodedHTML5 = entities.encodeHTML5(input);
        it(`should HTML5 encode ${input}`, () =>
            expect(encodedHTML5).toBe(html));
        it(`should HTML5 decode ${encodedHTML5}`, () =>
            expect(entities.decodeHTML(encodedHTML5)).toBe(input));
        it("should encode emojis", () =>
            expect(entities.encodeHTML5("😄🍾🥳💥😇")).toBe(
                "&#x1F604;&#x1F37E;&#x1F973;&#x1F4A5;&#x1F607;"
            ));
    }

    it("should encode data URIs (issue #16)", () => {
        const data =
            "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAALAAABAAEAAAIBRAA7";
        expect(entities.decode(entities.encode(data))).toBe(data);
    });
});

describe("encodeNonAsciiHTML", () => {
    it("should encode all non-ASCII characters", () =>
        expect(entities.encodeNonAsciiHTML("<test> #123! übermaßen")).toBe(
            "&lt;test&gt; #123! &uuml;berma&szlig;en"
        ));

    it("should encode emojis", () =>
        expect(entities.encodeNonAsciiHTML("😄🍾🥳💥😇")).toBe(
            "&#x1F604;&#x1F37E;&#x1F973;&#x1F4A5;&#x1F607;"
        ));
});
