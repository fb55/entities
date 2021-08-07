import path from "path";
import * as entities from ".";
import legacy from "./maps/legacy.json";

const levels = ["xml", "entities"];

describe("Documents", () => {
    const levelDocs = levels
        .map((n) => path.join("..", "src", "maps", n))
        .map(require)
        .map((doc, i) => [i, doc]);

    for (const [i, doc] of levelDocs) {
        describe("Decode", () => {
            it(levels[i], () => {
                for (const e of Object.keys(doc)) {
                    for (let l = i; l < levels.length; l++) {
                        expect(entities.decode(`&${e};`, l)).toBe(doc[e]);
                        expect(entities.decode(`&${e};`, { level: l })).toBe(
                            doc[e]
                        );
                    }
                }
            });
        });

        describe("Decode strict", () => {
            it(levels[i], () => {
                for (const e of Object.keys(doc)) {
                    for (let l = i; l < levels.length; l++) {
                        expect(entities.decodeStrict(`&${e};`, l)).toBe(doc[e]);
                        expect(
                            entities.decode(`&${e};`, {
                                level: l,
                                mode: entities.DecodingMode.Strict,
                            })
                        ).toBe(doc[e]);
                    }
                }
            });
        });

        describe("Encode", () => {
            it(levels[i], () => {
                for (const e of Object.keys(doc)) {
                    for (let l = i; l < levels.length; l++) {
                        const encoded = entities.encode(doc[e], l);
                        const decoded = entities.decode(encoded, l);
                        expect(decoded).toBe(doc[e]);
                    }
                }
            });

            it("should only encode non-ASCII values if asked", () =>
                expect(
                    entities.encode("Great #'s of 🎁", {
                        level: i,
                        mode: entities.EncodingMode.ASCII,
                    })
                ).toBe("Great #&apos;s of &#x1f381;"));
        });
    }

    describe("Legacy", () => {
        const legacyMap: Record<string, string> = legacy;
        it("should decode", () => {
            for (const e of Object.keys(legacyMap)) {
                expect(entities.decodeHTML(`&${e}`)).toBe(legacyMap[e]);
                expect(
                    entities.decodeStrict(`&${e}`, {
                        level: entities.EntityLevel.HTML,
                        mode: entities.DecodingMode.Legacy,
                    })
                ).toBe(legacyMap[e]);
            }
        });
    });
});

const astral = [
    ["1d306", "\uD834\uDF06"],
    ["1d11e", "\uD834\uDD1E"],
];

const astralSpecial = [
    ["80", "\u20AC"],
    ["110000", "\uFFFD"],
];

describe("Astral entities", () => {
    for (const [c, value] of astral) {
        it(`should decode ${value}`, () =>
            expect(entities.decode(`&#x${c};`)).toBe(value));

        it(`should encode ${value}`, () =>
            expect(entities.encode(value)).toBe(`&#x${c};`));

        it(`should escape ${value}`, () =>
            expect(entities.escape(value)).toBe(`&#x${c};`));
    }

    for (const [c, value] of astralSpecial) {
        it(`should decode special \\u${c}`, () =>
            expect(entities.decode(`&#x${c};`)).toBe(value));
    }
});

describe("Escape", () => {
    it("should always decode ASCII chars", () => {
        for (let i = 0; i < 0x7f; i++) {
            const c = String.fromCharCode(i);
            expect(entities.decodeXML(entities.escape(c))).toBe(c);
        }
    });

    it("should keep UTF8 characters", () =>
        expect(entities.escapeUTF8('ß < "ü"')).toBe(`ß &lt; &quot;ü&quot;`));
});
