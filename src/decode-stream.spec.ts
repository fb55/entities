import { describe, expect, it, vi } from "vitest";
import { DecodingMode, EntityDecoder } from "./decode.js";
import { htmlDecodeTree } from "./generated/decode-data-html.js";
import { xmlDecodeTree } from "./generated/decode-data-xml.js";

describe("EntityDecoder Streaming", () => {
    it("should decode long entities split across chunks (char-by-char)", () => {
        const callback = vi.fn();
        const decoder = new EntityDecoder(htmlDecodeTree, callback);

        const entity = "&CounterClockwiseContourIntegral;";
        const codepoint = 8755; // ∳

        decoder.startEntity(DecodingMode.Strict);

        // Feed char by char starting after '&'
        for (let index = 1; index < entity.length; index++) {
            const char = entity[index];
            const result = decoder.write(char, 0);

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

    it("should not over-consume a legacy compact-run entity (e.g. `&Egrave`)", () => {
        const callback = vi.fn();
        const decoder = new EntityDecoder(htmlDecodeTree, callback);

        /*
         * The `&Egrave` string is a legacy (semicolon-optional) entity stored
         * as a compact run. When it is terminated by the next character, only
         * its 7 characters (`&Egrave`) should be consumed -- the following `&`
         * must remain available to start the next entity.
         */
        decoder.startEntity(DecodingMode.Legacy);

        expect(decoder.write("&Egrave&CHcy", 1)).toBe(7);
        expect(callback).toHaveBeenCalledWith(0xc8, 7); // È
    });

    it("should decode xml entities (single chunk)", () => {
        const callback = vi.fn();
        const decoder = new EntityDecoder(xmlDecodeTree, callback);

        const data = "&amp;&gt;&amp&lt;&copy;&#x61;&#x62&#99;&#100&#101";

        for (let index = 0; index < data.length; index++) {
            if (data.charAt(index) !== "&") {
                continue;
            }

            decoder.startEntity(DecodingMode.Strict);
            const offset = decoder.write(data, index + 1);

            if (offset === -1) {
                break;
            }

            if (offset > 0) {
                index += offset - 1; // -1 because of the for loop increment
            }
        }

        decoder.end();

        expect(callback).toHaveBeenNthCalledWith(1, 38, 5); // &amp;
        expect(callback).toHaveBeenNthCalledWith(2, 62, 4); // &gt;
        // NOT &amp
        expect(callback).toHaveBeenNthCalledWith(3, 60, 4); // &lt;
        // NOT &copy;
        expect(callback).toHaveBeenNthCalledWith(4, 97, 6); // &#x61;
        // NOT &#x62
        expect(callback).toHaveBeenNthCalledWith(5, 99, 5); // &#99;
        /*
         * NOT &#100
         * NOT &#101
         */

        expect(callback).toHaveBeenCalledTimes(5);
    });

    it("should decode xml entities (char-by-char)", () => {
        const callback = vi.fn();
        const decoder = new EntityDecoder(xmlDecodeTree, callback);

        const data = "&amp;&gt;&amp&lt;&copy;&#x61;&#x62&#99;&#100&#101";

        let isInEntity = false;
        for (let index = 0; index < data.length; index++) {
            const char = data[index];

            if (!isInEntity) {
                if (char === "&") {
                    decoder.startEntity(DecodingMode.Strict);
                    isInEntity = true;
                }
                continue;
            }

            const offset = decoder.write(char, 0);

            if (offset === -1) {
                if (char === "&") {
                    isInEntity = false;
                    index -= 1; // Reprocess '&' as a new entity start.
                }
                continue;
            }

            isInEntity = false;

            if (offset === 0) {
                index -= 1; // Reprocess current char outside the failed entity.
            }
        }

        decoder.end();

        expect(callback).toHaveBeenNthCalledWith(1, 38, 5); // &amp;
        expect(callback).toHaveBeenNthCalledWith(2, 62, 4); // &gt;
        // NOT &amp
        expect(callback).toHaveBeenNthCalledWith(3, 60, 4); // &lt;
        // NOT &copy;
        expect(callback).toHaveBeenNthCalledWith(4, 97, 6); // &#x61;
        // NOT &#x62
        expect(callback).toHaveBeenNthCalledWith(5, 99, 5); // &#99;
        /*
         * NOT &#100
         * NOT &#101
         */

        expect(callback).toHaveBeenCalledTimes(5);
    });

    /*
     * A legacy entity ending in a compact run (`&Aacute` — "cute" is a run)
     * must report exactly the entity's length as consumed (7, not 8): the
     * run's final character is part of the match, not excess. One extra
     * consumed character here makes a streaming parser swallow the
     * character following the entity.
     */
    describe("consumed count for legacy entities ending in a compact run", () => {
        const entity = "&Aacute"; // 7 chars; "cute" is a compact run.
        const codepoint = 0xc1; // Á

        it("should report 7 consumed when terminated by another char", () => {
            const callback = vi.fn();
            const decoder = new EntityDecoder(htmlDecodeTree, callback);

            decoder.startEntity(DecodingMode.Legacy);
            expect(decoder.write(`${entity} x`, 1)).toBe(entity.length);
            expect(callback).toHaveBeenCalledWith(codepoint, entity.length);
        });

        it("should report 7 consumed at the end of input", () => {
            const callback = vi.fn();
            const decoder = new EntityDecoder(htmlDecodeTree, callback);

            decoder.startEntity(DecodingMode.Legacy);
            expect(decoder.write(entity, 1)).toBe(-1);
            expect(decoder.end()).toBe(entity.length);
            expect(callback).toHaveBeenCalledWith(codepoint, entity.length);
        });

        it("should report 7 consumed when written char-by-char", () => {
            const callback = vi.fn();
            const decoder = new EntityDecoder(htmlDecodeTree, callback);

            decoder.startEntity(DecodingMode.Legacy);
            for (let index = 1; index < entity.length; index++) {
                expect(decoder.write(entity[index], 0)).toBe(-1);
            }
            expect(decoder.write(" ", 0)).toBe(entity.length);
            expect(callback).toHaveBeenCalledWith(codepoint, entity.length);
        });

        it("should still include the semicolon when present", () => {
            const callback = vi.fn();
            const decoder = new EntityDecoder(htmlDecodeTree, callback);

            decoder.startEntity(DecodingMode.Legacy);
            expect(decoder.write(`${entity};`, 1)).toBe(entity.length + 1);
            expect(callback).toHaveBeenCalledWith(codepoint, entity.length + 1);
        });

        it("should reject in attribute mode when followed by `=`", () => {
            const callback = vi.fn();
            const decoder = new EntityDecoder(htmlDecodeTree, callback);

            decoder.startEntity(DecodingMode.Attribute);
            expect(decoder.write(`${entity}=`, 1)).toBe(0);
            expect(callback).not.toHaveBeenCalled();
        });
    });
});
