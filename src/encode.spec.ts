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
        test(`should XML encode ${input}`, () => expect(encodedXML).toBe(xml));
        test(`should default to XML encode ${input}`, () =>
            expect(entities.encode(input)).toBe(xml));
        test(`should XML decode ${encodedXML}`, () =>
            expect(entities.decodeXML(encodedXML)).toBe(input));
        test(`should default to XML encode ${encodedXML}`, () =>
            expect(entities.decode(encodedXML)).toBe(input));
        test(`should default strict to XML encode ${encodedXML}`, () =>
            expect(entities.decodeStrict(encodedXML)).toBe(input));

        const encodedHTML5 = entities.encodeHTML5(input);
        test(`should HTML5 encode ${input}`, () =>
            expect(encodedHTML5).toBe(html));
        test(`should HTML5 decode ${encodedHTML5}`, () =>
            expect(entities.decodeHTML(encodedHTML5)).toBe(input));
    }

    test("should encode data URIs (issue #16)", () => {
        const data =
            "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAALAAABAAEAAAIBRAA7";
        expect(entities.decode(entities.encode(data))).toBe(data);
    });
});
