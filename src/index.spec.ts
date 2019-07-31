import path from "path";
import * as entities from ".";
import legacy from "./maps/legacy.json";

const levels = ["xml", "entities"];

describe("Documents", () => {
    levels
        .map(n => path.join("..", "src", "maps", n))
        .map(require)
        .forEach((doc, i) => {
            describe("Decode", () => {
                test(levels[i], () =>
                    Object.keys(doc).forEach(e => {
                        for (let l = i; l < levels.length; l++) {
                            expect(entities.decode(`&${e};`, l)).toBe(doc[e]);
                        }
                    })
                );
            });

            describe("Decode strict", () => {
                test(levels[i], () =>
                    Object.keys(doc).forEach(e => {
                        for (let l = i; l < levels.length; l++) {
                            expect(entities.decodeStrict(`&${e};`, l)).toBe(
                                doc[e]
                            );
                        }
                    })
                );
            });

            describe("Encode", () => {
                test(levels[i], () =>
                    Object.keys(doc).forEach(e => {
                        for (let l = i; l < levels.length; l++) {
                            expect(
                                entities.decode(entities.encode(doc[e], l), l)
                            ).toBe(doc[e]);
                        }
                    })
                );
            });
        });

    describe("Legacy", () => {
        test("should decode", () =>
            Object.keys(legacy).forEach(e =>
                // @ts-ignore
                expect(entities.decodeHTML(`&${e}`)).toBe(legacy[e])
            ));
    });
});

const astral = {
    "1D306": "\uD834\uDF06",
    "1D11E": "\uD834\uDD1E"
};

const astralSpecial = {
    "80": "\u20AC",
    "110000": "\uFFFD"
};

describe("Astral entities", () => {
    Object.keys(astral).forEach(c => {
        // @ts-ignore
        const value: string = astral[c];
        test(`should decode ${value}`, () =>
            expect(entities.decode(`&#x${c};`)).toBe(value));

        test(`should encode ${value}`, () =>
            expect(entities.encode(value)).toBe(`&#x${c};`));

        test(`should escape ${value}`, () =>
            expect(entities.escape(value)).toBe(`&#x${c};`));
    });

    Object.keys(astralSpecial).forEach(c => {
        test(`special should decode \\u${c}`, () =>
            // @ts-ignore
            expect(entities.decode(`&#x${c};`)).toBe(astralSpecial[c]));
    });
});

describe("Escape", () => {
    test("should always decode ASCII chars", () => {
        for (let i = 0; i < 0x7f; i++) {
            const c = String.fromCharCode(i);
            expect(entities.decodeXML(entities.escape(c))).toBe(c);
        }
    });
});
