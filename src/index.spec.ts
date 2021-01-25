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
            test(levels[i], () => {
                for (const e of Object.keys(doc)) {
                    for (let l = i; l < levels.length; l++) {
                        expect(entities.decode(`&${e};`, l)).toBe(doc[e]);
                    }
                }
            });
        });

        describe("Decode strict", () => {
            test(levels[i], () => {
                for (const e of Object.keys(doc)) {
                    for (let l = i; l < levels.length; l++) {
                        expect(entities.decodeStrict(`&${e};`, l)).toBe(doc[e]);
                    }
                }
            });
        });

        describe("Encode", () => {
            test(levels[i], () => {
                for (const e of Object.keys(doc)) {
                    for (let l = i; l < levels.length; l++) {
                        expect(
                            entities.decode(entities.encode(doc[e], l), l)
                        ).toBe(doc[e]);
                    }
                }
            });
        });
    }

    describe("Legacy", () => {
        test("should decode", () => {
            for (const e of Object.keys(legacy)) {
                expect(entities.decodeHTML(`&${e}`)).toBe(
                    (legacy as Record<string, string>)[e]
                );
            }
        });
    });
});

const astral = [
    ["1D306", "\uD834\uDF06"],
    ["1D11E", "\uD834\uDD1E"],
];

const astralSpecial = [
    ["80", "\u20AC"],
    ["110000", "\uFFFD"],
];

describe("Astral entities", () => {
    for (const [c, value] of astral) {
        test(`should decode ${value}`, () =>
            expect(entities.decode(`&#x${c};`)).toBe(value));

        test(`should encode ${value}`, () =>
            expect(entities.encode(value)).toBe(`&#x${c};`));

        test(`should escape ${value}`, () =>
            expect(entities.escape(value)).toBe(`&#x${c};`));

        test(`should escapeUTF8 ${value}`, () =>
            expect(entities.escapeUTF8(value)).toBe(`&#x${c};`));
    }

    for (const [c, value] of astralSpecial) {
        test(`special should decode \\u${c}`, () =>
            expect(entities.decode(`&#x${c};`)).toBe(value));
    }
});

describe("Escape", () => {
    test("should always decode ASCII chars", () => {
        for (let i = 0; i < 0x7f; i++) {
            const c = String.fromCharCode(i);
            expect(entities.decodeXML(entities.escape(c))).toBe(c);
        }
    });
});
