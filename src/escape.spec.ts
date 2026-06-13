import { describe, expect, it } from "vitest";
import * as entities from "./index.js";

describe("escape HTML", () => {
    it("should escape HTML attribute values", () =>
        expect(entities.escapeAttribute('<a " attr > & value  !')).toBe(
            "<a &quot; attr > &amp; value &nbsp;!",
        ));

    it("should escape HTML text", () =>
        expect(entities.escapeText('<a " text > & value  !')).toBe(
            '&lt;a " text &gt; &amp; value &nbsp;!',
        ));
});

describe("encodeXML scan", () => {
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
        expect(entities.encodeXML("a\uD83Db")).toBe("a&#55357;b");
        expect(entities.encodeXML("a\uDE00b")).toBe("a&#56832;b");
        expect(entities.encodeXML(`${"a".repeat(40)}\uD83D`)).toBe(
            `${"a".repeat(40)}&#55357;`,
        );
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
});
