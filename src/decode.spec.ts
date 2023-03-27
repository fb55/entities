import * as entities from "./decode.js";

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
        { input: "&>", output: "&>" },
        { input: "id=770&#anchor", output: "id=770&#anchor" },
    ];

    for (const { input, output } of testcases) {
        it(`should XML decode ${input}`, () =>
            expect(entities.decodeXML(input)).toBe(output));
        it(`should HTML decode ${input}`, () =>
            expect(entities.decodeHTML(input)).toBe(output));
    }

    it("should HTML decode partial legacy entity", () => {
        expect(entities.decodeHTMLStrict("&timesbar")).toBe("&timesbar");
        expect(entities.decodeHTML("&timesbar")).toBe("×bar");
    });

    it("should HTML decode legacy entities according to spec", () =>
        expect(entities.decodeHTML("?&image_uri=1&ℑ=2&image=3")).toBe(
            "?&image_uri=1&ℑ=2&image=3"
        ));

    it("should back out of legacy entities", () =>
        expect(entities.decodeHTML("&ampa")).toBe("&a"));

    it("should not parse numeric entities in strict mode", () =>
        expect(entities.decodeHTMLStrict("&#55")).toBe("&#55"));

    it("should parse &nbsp followed by < (#852)", () =>
        expect(entities.decodeHTML("&nbsp<")).toBe("\u00a0<"));
});

describe("EntityDecoder", () => {
    it("should decode numeric entities", () => {
        const cb = jest.fn();
        const decoder = new entities.EntityDecoder(entities.xmlDecodeTree, cb);

        decoder.write("&#x3a;", 1);

        expect(cb).toHaveBeenCalledWith(":");

        decoder.end();

        expect(cb).toHaveBeenCalledTimes(1);
    });

    it("should decode named entities", () => {
        const cb = jest.fn();
        const decoder = new entities.EntityDecoder(entities.xmlDecodeTree, cb);

        decoder.write("&amp;", 1);

        expect(cb).toHaveBeenNthCalledWith(1, "&");

        decoder.end();

        expect(cb).toHaveBeenCalledTimes(1);
    });

    it("should decode legacy entities", () => {
        const cb = jest.fn();
        const decoder = new entities.EntityDecoder(entities.xmlDecodeTree, cb);

        decoder.write("&amp", 1);

        expect(cb).not.toHaveBeenCalled();

        decoder.end();

        expect(cb).toHaveBeenNthCalledWith(1, "&");
        expect(cb).toHaveBeenCalledTimes(1);
    });
});
