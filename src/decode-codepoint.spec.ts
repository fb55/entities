import { describe, expect, it } from "vitest";
import { replaceCodePoint, replaceCodePointXML } from "./decode-codepoint.js";

describe("replaceCodePoint", () => {
    it("should remap C1 controls to Windows-1252", () => {
        expect(replaceCodePoint(0x80)).toBe(0x20_ac);
        expect(replaceCodePoint(0x9a)).toBe(0x1_61);
        expect(replaceCodePoint(0x81)).toBe(0x81);
    });

    it("should replace NUL, surrogates, and out-of-range values", () => {
        expect(replaceCodePoint(0)).toBe(0xff_fd);
        expect(replaceCodePoint(0xd8_00)).toBe(0xff_fd);
        expect(replaceCodePoint(0x11_00_00)).toBe(0xff_fd);
    });
});

describe("replaceCodePointXML", () => {
    it("should leave C1 controls unchanged", () => {
        expect(replaceCodePointXML(0x80)).toBe(0x80);
        expect(replaceCodePointXML(0x9a)).toBe(0x9a);
        expect(replaceCodePointXML(0x81)).toBe(0x81);
    });

    it("should still replace NUL, surrogates, and out-of-range values", () => {
        expect(replaceCodePointXML(0)).toBe(0xff_fd);
        expect(replaceCodePointXML(0xd8_00)).toBe(0xff_fd);
        expect(replaceCodePointXML(0x11_00_00)).toBe(0xff_fd);
    });
});
