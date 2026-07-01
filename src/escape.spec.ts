import { describe, expect, it } from "vitest";
import { getCodePoint } from "./escape.js";
import * as entities from "./index.js";

describe("escape HTML", () => {
    it("should escape HTML attribute values", () =>
        expect(entities.escapeAttribute('<a " attr > & value \u{A0}!')).toBe(
            "<a &quot; attr > &amp; value &nbsp;!",
        ));

    it("should escape HTML text", () =>
        expect(entities.escapeText('<a " text > & value \u{A0}!')).toBe(
            '&lt;a " text &gt; &amp; value &nbsp;!',
        ));
});

describe("getCodePoint", () => {
    it("should be exported as a function", () =>
        expect(typeof getCodePoint).toBe("function"));

    it("should read BMP code points", () => {
        expect(getCodePoint("abc", 0)).toBe(97);
        expect(getCodePoint("abc", 2)).toBe(99);
        expect(getCodePoint("ü", 0)).toBe(0xfc);
    });

    it("should read astral code points from surrogate pairs", () => {
        expect(getCodePoint("💯", 0)).toBe(128_175);
        expect(getCodePoint("a\u{1F4A9}", 1)).toBe(0x1_f4_a9);
    });
});

describe("encodeXML scan", () => {
    it("should return clean input unchanged", () => {
        // Nothing escapable: the window runs clean to the end, firing the identity return.
        expect(entities.encodeXML("abc123")).toBe("abc123");
        expect(entities.encodeXML("simple text")).toBe("simple text");
    });

    it("should escape adjacent specials", () => {
        // Consecutive matches: each special is escaped without a scan jump.
        expect(entities.encodeXML("&&")).toBe("&amp;&amp;");
        expect(entities.encodeXML("<>")).toBe("&lt;&gt;");
        expect(entities.encodeXML(`'"`)).toBe("&apos;&quot;");
    });

    it("should escape characters found via the regex fallback", () => {
        /*
         * A clean run longer than the 32-char inline window forces the regex
         * path, for both an ASCII special and a non-ASCII character.
         */
        const span = "a".repeat(64);
        expect(entities.encodeXML(`${span}&${span}`)).toBe(
            `${span}&amp;${span}`,
        );
        expect(entities.encodeXML(`${span}ü`)).toBe(`${span}&#252;`);
    });

    it("should encode surrogate pairs, including via the regex fallback", () => {
        // The trailing surrogate is skipped; the code point comes from the pair.
        expect(entities.encodeXML("x😀x")).toBe("x&#128512;x");
        expect(entities.encodeXML("😀🐊")).toBe("&#128512;&#128010;");
        // Pair located by the regex (after a clean span past the window).
        const span = "a".repeat(40);
        expect(entities.encodeXML(`${span}😀`)).toBe(`${span}&#128512;`);
    });

    it("should encode lone surrogates by code unit", () => {
        /*
         * The regex has no `u` flag, so unpaired surrogates match and encode
         * as their bare unit value (codePointAt returns the surrogate itself).
         */
        expect(entities.encodeXML("a\u{D83D}b")).toBe("a&#55357;b");
        expect(entities.encodeXML("a\u{DE00}b")).toBe("a&#56832;b");
        const prefix = "a".repeat(40);
        const loneSurrogate = String.fromCharCode(0xd8_3d);
        expect(entities.encodeXML(`${prefix}${loneSurrogate}`)).toBe(
            `${prefix}&#55357;`,
        );
    });

    it("should not leak regex lastIndex between calls", () => {
        /*
         * `encodeXML` drives the module-level `xmlEncodeRegex` and sets its
         * `lastIndex` before every `exec`. A stale value from a prior call
         * (here a longer input) must not make the next call's regex jump skip
         * past an earlier special. Ordered long-then-short so a leaked index
         * would land beyond the `&` and drop it.
         */
        const long = "a".repeat(100);
        expect(entities.encodeXML(`${long}&`)).toBe(`${long}&amp;`);
        const short = "a".repeat(40);
        expect(entities.encodeXML(`${short}&`)).toBe(`${short}&amp;`);
    });
});

describe("escape helpers (shared exec loop)", () => {
    it("should return the input unchanged when nothing matches", () => {
        /*
         * The match-free early return; the helpers are not otherwise
         * exercised with input that produces no match.
         */
        expect(entities.escapeUTF8("no specials")).toBe("no specials");
        expect(entities.escapeText("no specials")).toBe("no specials");
    });

    it("should escape `'` via escapeUTF8", () => {
        /*
         * The apostrophe arm of the shared dispatch is reachable only through
         * escapeUTF8, whose set is the only one including `'`.
         */
        expect(entities.escapeUTF8("&&a''")).toBe("&amp;&amp;a&apos;&apos;");
    });

    it("should reset regex state between repeated calls", () => {
        /*
         * The shared `/g` regexes are module-level. `escapeWithRegex` runs
         * `exec` until it returns null (which resets `lastIndex` to 0), so
         * repeated calls stay correct; this pins that contract by calling each
         * helper twice — a match near the end, then one at the start. (The
         * riskier `encodeXML` path, which sets `lastIndex` manually and can
         * leave it non-zero, is covered separately above.)
         */
        expect(entities.escapeUTF8("aaaaaaaaaa&")).toBe("aaaaaaaaaa&amp;");
        expect(entities.escapeUTF8("&")).toBe("&amp;");
        expect(entities.escapeAttribute('aaaaaaaaaa"')).toBe(
            "aaaaaaaaaa&quot;",
        );
        expect(entities.escapeAttribute('"')).toBe("&quot;");
        expect(entities.escapeText("aaaaaaaaaa<")).toBe("aaaaaaaaaa&lt;");
        expect(entities.escapeText("<")).toBe("&lt;");
    });
});
