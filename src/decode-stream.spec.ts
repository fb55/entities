import { describe, expect, it, vi } from "vitest";
import { DecodingMode, EntityDecoder } from "./decode.js";
import { htmlDecodeTree } from "./generated/decode-data-html.js";

describe("EntityDecoder Streaming", () => {
    it("should decode long entities split across chunks (char-by-char)", () => {
        const callback = vi.fn();
        const decoder = new EntityDecoder(htmlDecodeTree, callback);

        const entity = "&CounterClockwiseContourIntegral;";
        const codepoint = 8755; // ∳

        decoder.startEntity(DecodingMode.Strict);

        // Feed char by char starting after '&'
        let result = -1;
        for (let index = 1; index < entity.length; index++) {
            const char = entity[index];
            result = decoder.write(char, 0);

            if (index < entity.length - 1) {
                expect(result).toBe(-1);
            } else {
                expect(result).toBe(entity.length);
            }
        }

        expect(callback).toHaveBeenCalledWith(codepoint, entity.length);
    });

    it("should decode distinct chunks", () => {
        const callback = vi.fn();
        const decoder = new EntityDecoder(htmlDecodeTree, callback);

        const part1 = "&CounterClockwise";
        const part2 = "ContourIntegral;";

        decoder.startEntity(DecodingMode.Strict);

        expect(decoder.write(part1.substring(1), 0)).toBe(-1);
        expect(decoder.write(part2, 0)).toBe(33);

        expect(callback).toHaveBeenCalledWith(8755, 33);
    });
});
