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

    it("should decode trailing legacy entities", () => {
        expect(entities.decodeHTML("&timesbar;&timesbar")).toBe("⨱×bar");
    });

    it("should decode multi-byte entities", () => {
        expect(entities.decodeHTML("&NotGreaterFullEqual;")).toBe("≧̸");
    });
});

describe("EntityDecoder", () => {
    it("should decode numeric entities", () => {
        const cb = jest.fn();
        const decoder = new entities.EntityDecoder(entities.htmlDecodeTree, cb);

        expect(decoder.write("&#x3a;", 1)).toBe(6);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(":".charCodeAt(0), 6);
    });

    it("should decode named entities", () => {
        const cb = jest.fn();
        const decoder = new entities.EntityDecoder(entities.htmlDecodeTree, cb);

        expect(decoder.write("&amp;", 1)).toBe(5);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith("&".charCodeAt(0), 5);
    });

    it("should decode legacy entities", () => {
        const cb = jest.fn();
        const decoder = new entities.EntityDecoder(entities.htmlDecodeTree, cb);
        decoder.startEntity(entities.EntityDecoderMode.Text);

        expect(decoder.write("&amp", 1)).toBe(-1);

        expect(cb).not.toHaveBeenCalled();

        expect(decoder.end()).toBe(4);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith("&".charCodeAt(0), 4);
    });

    it("should decode named entity written character by character", () => {
        const cb = jest.fn();
        const decoder = new entities.EntityDecoder(entities.htmlDecodeTree, cb);

        for (const c of "amp") {
            expect(decoder.write(c, 0)).toBe(-1);
        }
        expect(decoder.write(";", 0)).toBe(5);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith("&".charCodeAt(0), 5);
    });

    it("should decode numeric entity written character by character", () => {
        const cb = jest.fn();
        const decoder = new entities.EntityDecoder(entities.htmlDecodeTree, cb);

        for (const c of "#x3a") {
            expect(decoder.write(c, 0)).toBe(-1);
        }
        expect(decoder.write(";", 0)).toBe(6);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(":".charCodeAt(0), 6);
    });
});
