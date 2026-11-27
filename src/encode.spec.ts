import { describe, expect, it } from "vitest";
import { INLINE_SCAN_WINDOW } from "./encode.js";
import * as entities from "./index.js";

describe("named entity aliases", () => {
    it.each([
        ["ℵ", "&aleph;"],
        ["≌", "&bcong;"],
        ["∖", "&setmn;"],
    ])("encodes %s using %s", (input, expected) => {
        expect(entities.encodeHTML(input)).toBe(expected);
        expect(entities.encodeNonAsciiHTML(input)).toBe(expected);
    });
});

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
        expect(entities.encodeXML(input)).toBe(xml),
    );
    it.each(testcases)(
        "should default to XML encode $input",
        ({ input, xml }) => expect(entities.encode(input)).toBe(xml),
    );
    it.each(testcases)("should XML decode $xml", ({ input, xml }) =>
        expect(entities.decodeXML(xml)).toBe(input),
    );
    it.each(testcases)("should default to XML decode $xml", ({ input, xml }) =>
        expect(entities.decode(xml)).toBe(input),
    );
    it.each(testcases)(
        "should default strict to XML decode $xml",
        ({ input, xml }) =>
            expect(
                entities.decode(xml, { mode: entities.DecodingMode.Strict }),
            ).toBe(input),
    );
    it.each(testcases)("should HTML encode $input", ({ input, html }) =>
        expect(entities.encodeHTML(input)).toBe(html),
    );
    it.each(testcases)("should HTML decode $html", ({ input, html }) =>
        expect(entities.decodeHTML(html)).toBe(input),
    );

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
        expect(entities.encodeHTML("\u{D835}")).toBe("&#55349;"));

    it("should encode surrogate pair with first surrogate equivalent of entity, without corresponding entity", () =>
        expect(entities.encodeHTML("\u{1D4A4}")).toBe("&#119972;"));
});

describe("multi-code-point entities with ASCII starters", () => {
    it("should encode < + U+20D2 as &nvlt;", () =>
        expect(entities.encodeHTML("<\u{20D2}")).toBe("&nvlt;"));

    it("should encode > + U+20D2 as &nvgt;", () =>
        expect(entities.encodeHTML(">\u{20D2}")).toBe("&nvgt;"));

    it("should encode = + U+20E5 as &bne;", () =>
        expect(entities.encodeHTML("=\u{20E5}")).toBe("&bne;"));

    it("should still encode < alone as &lt;", () =>
        expect(entities.encodeHTML("<")).toBe("&lt;"));

    it("should still encode > alone as &gt;", () =>
        expect(entities.encodeHTML(">")).toBe("&gt;"));

    it("should encode < followed by unrelated char as &lt; + numeric", () =>
        expect(entities.encodeHTML("<\u{20D3}")).toBe("&lt;&#8403;"));
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

describe("C1 control characters", () => {
    /*
     * HTML parsers remap numeric references to most of U+0080-U+009F using
     * the Windows-1252 table (e.g. `&#128;` reads as U+20AC), so those
     * characters cannot be written as references.
     */
    const c1 = Array.from({ length: 32 }, (_, index) =>
        String.fromCharCode(0x80 + index),
    );

    it.each(c1)("should round-trip %j through decodeHTML", (char) => {
        const input = `a${char}b`;
        expect(entities.decodeHTML(entities.encodeHTML(input))).toBe(input);
        expect(entities.decodeHTML(entities.encodeNonAsciiHTML(input))).toBe(
            input,
        );
    });

    it("should leave remapped C1 characters unencoded", () => {
        expect(entities.encodeHTML("\u{80}\u{9F}")).toBe("\u{80}\u{9F}");
        expect(entities.encodeNonAsciiHTML("<\u{80}>")).toBe("&lt;\u{80}&gt;");
    });

    it("should still encode C1 characters that are not remapped", () => {
        expect(entities.encodeHTML("\u{81}\u{8D}\u{8F}\u{90}\u{9D}")).toBe(
            "&#129;&#141;&#143;&#144;&#157;",
        );
    });

    it("should still encode C1 characters as references in XML", () =>
        expect(entities.encodeXML("\u{80}")).toBe("&#128;"));
});

describe("scan-path consistency (regex jump vs inline scan)", () => {
    /*
     * The scan uses a bitset to test single characters inline and a regex to
     * skip clean spans. These are two hand-maintained encodings of the same
     * set, so a drift between them would silently let a character slip through
     * the regex-jump path unencoded. Encoding each code unit both alone (inline
     * path) and after a long clean prefix (which forces the regex-jump path)
     * must agree for every code unit, in both HTML and non-ASCII modes.
     *
     * The prefix is derived from `INLINE_SCAN_WINDOW` so it keeps forcing the
     * regex path even if that constant is retuned upward.
     */
    const prefix = "a".repeat(INLINE_SCAN_WINDOW * 4);
    it.each([
        ["encodeHTML", entities.encodeHTML],
        ["encodeNonAsciiHTML", entities.encodeNonAsciiHTML],
    ])(
        "%s: regex-jump path matches inline path for all code units",
        (_, encoder) => {
            const mismatches: number[] = [];
            for (let code = 0; code <= 0xff_ff; code++) {
                const ch = String.fromCharCode(code);
                const inline = encoder(ch);
                const viaRegex = encoder(prefix + ch).slice(prefix.length);
                if (viaRegex !== inline) mismatches.push(code);
            }
            expect(mismatches).toStrictEqual([]);
        },
    );
});
