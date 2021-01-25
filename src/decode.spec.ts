import * as entities from "./decode";

describe("Decode test", () => {
    const testcases = [
        { input: "&amp;amp;", output: "&amp;" },
        { input: "&amp;#38;", output: "&#38;" },
        { input: "&amp;#x26;", output: "&#x26;" },
        { input: "&amp;#X26;", output: "&#X26;" },
        { input: "&#38;#38;", output: "&#38;" },
        { input: "&#x26;#38;", output: "&#38;" },
        { input: "&#X26;#38;", output: "&#38;" },
        { input: "&#x3a;", output: ":" },
        { input: "&#x3A;", output: ":" },
        { input: "&#X3a;", output: ":" },
        { input: "&#X3A;", output: ":" },
    ];

    for (const { input, output } of testcases) {
        it(`should XML decode ${input}`, () =>
            expect(entities.decodeXML(input)).toBe(output));
        it(`should HTML4 decode ${input}`, () =>
            expect(entities.decodeHTML(input)).toBe(output));
        it(`should HTML5 decode ${input}`, () =>
            expect(entities.decodeHTML(input)).toBe(output));
    }
});
