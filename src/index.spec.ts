import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import legacy from "../maps/legacy.json" with { type: "json" };
import * as entities from "./index.js";

const levels = ["xml", "entities"];

describe("Documents", () => {
    const levelDocuments = levels
        .map((name) => new URL(`../maps/${name}.json`, import.meta.url))
        .map((url) => JSON.parse(readFileSync(url, "utf8")))
        .map((document, index) => ({
            name: levels[index],
            level: index,
            document,
        }));

    describe.each(levelDocuments)("$name", ({ level, document }) => {
        describe("Decode", () => {
            it("should decode all entities", () => {
                for (const [entity, value] of Object.entries(document)) {
                    for (let l = level; l < levels.length; l++) {
                        expect(entities.decode(`&${entity};`, l)).toBe(value);
                        expect(
                            entities.decode(`&${entity};`, { level: l }),
                        ).toBe(value);
                    }
                }
            });
        });

        describe("Decode strict", () => {
            it("should decode all entities", () => {
                for (const [entity, value] of Object.entries(document)) {
                    for (let l = level; l < levels.length; l++) {
                        expect(
                            entities.decode(`&${entity};`, {
                                level: l,
                                mode: entities.DecodingMode.Strict,
                            }),
                        ).toBe(value);
                    }
                }
            });
        });

        describe("Encode", () => {
            it("should roundtrip all entities", () => {
                for (const value of Object.values<string>(document)) {
                    for (let l = level; l < levels.length; l++) {
                        const encoded = entities.encode(value, l);
                        const decoded = entities.decode(encoded, l);
                        expect(decoded).toBe(value);
                    }
                }
            });

            it("should only encode non-ASCII values if asked", () =>
                expect(
                    entities.encode("Great #'s of 🎁", {
                        level,
                        mode: entities.EncodingMode.ASCII,
                    }),
                ).toBe("Great #&apos;s of &#127873;"));
        });
    });

    describe("Legacy", () => {
        const legacyMap: Record<string, string> = legacy;
        it("should decode", () => {
            for (const [entity, value] of Object.entries(legacyMap)) {
                expect(entities.decodeHTML(`&${entity}`)).toBe(value);
                expect(
                    entities.decode(`&${entity}`, {
                        level: entities.EntityLevel.HTML,
                        mode: entities.DecodingMode.Legacy,
                    }),
                ).toBe(value);
            }
        });
    });
});

const astral = [
    ["1d306", "\u{1D306}"],
    ["1d11e", "\u{1D11E}"],
];

const astralSpecial = [
    ["80", "\u{20AC}"],
    ["110000", "\u{FFFD}"],
];

describe("Astral entities", () => {
    it.each(astral)("should decode &#x%s;", (c, value) =>
        expect(entities.decode(`&#x${c};`)).toBe(value));

    it.each(astral)("should encode &#x%s;", (c, value) =>
        expect(entities.encode(value)).toBe(`&#${Number.parseInt(c, 16)};`));

    it.each(astral)("should escape &#x%s;", (c, value) =>
        expect(entities.escape(value)).toBe(`&#${Number.parseInt(c, 16)};`));

    it.each(astralSpecial)(String.raw`should decode special \u%s`, (c, value) =>
        expect(entities.decode(`&#x${c};`)).toBe(value));
});

describe("Escape", () => {
    it("should always decode ASCII chars", () => {
        for (let index = 0; index < 0x7f; index++) {
            const c = String.fromCharCode(index);
            expect(entities.decodeXML(entities.escape(c))).toBe(c);
        }
    });

    it("should keep UTF8 characters", () =>
        expect(entities.escapeUTF8('ß < "ü"')).toBe("ß &lt; &quot;ü&quot;"));
});
