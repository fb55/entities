import { describe, expect, it } from "vitest";
import entityMap from "../../maps/entities.json" with { type: "json" };
import legacyMap from "../../maps/legacy.json" with { type: "json" };
import xmlMap from "../../maps/xml.json" with { type: "json" };
import { decodeTrieDict } from "../../src/internal/decode-shared.js";
import { encodeFullTrie, tryEncodeWithSplit } from "./encode-dict.js";
import { encodeTrie } from "./encode-trie.js";
import { getTrie } from "./trie.js";

/*
 * The dict/BPE string encoder here and the runtime `decodeTrieDict` in
 * src/internal/decode-shared.ts are hand-synced implementations of the same
 * format. These specs round-trip real and synthetic data through both, so a
 * change to either side that breaks the agreement fails loudly instead of
 * corrupting the shipped trie.
 */

/**
 * Encode with the writer, decode with the runtime reader, and expect the
 * original data back.
 * @param data Uint16 values to round-trip.
 * @param dictSize Optional fixed dictSize; defaults to the full search.
 */
function roundTrip(data: Uint16Array, dictSize?: number): void {
    const result =
        dictSize === undefined
            ? encodeFullTrie(data)
            : tryEncodeWithSplit(data, dictSize);
    expect(result).not.toBeNull();
    const decoded = decodeTrieDict(
        result!.encoded,
        data.length,
        result!.atomCount,
        result!.dict1AtomCount,
        result!.ngramCount,
        result!.dictSize,
    );
    expect(decoded).toStrictEqual(data);
}

describe("encode-dict ↔ decodeTrieDict round-trip", () => {
    it("should round-trip the real HTML trie", () => {
        const data = new Uint16Array(
            encodeTrie(getTrie(entityMap, legacyMap)),
        );
        roundTrip(data);
    });

    it("should round-trip the real XML trie", () => {
        /*
         * Shipped inline (too small for the dict), but the format must
         * still round-trip; the tiny atom count needs a small dictSize.
         */
        const data = new Uint16Array(encodeTrie(getTrie(xmlMap, {})));
        roundTrip(data, 10);
    });

    it("should round-trip repeated patterns (exercises BPE ngrams)", () => {
        const values: number[] = [];
        for (let index = 0; index < 200; index++) {
            values.push(7, 1000, 42, 7, 1000, index % 5);
        }
        roundTrip(new Uint16Array(values), 4);
    });

    it("should round-trip large deltas (escape and double-escape)", () => {
        /*
         * Deltas: 88 (max 1-char), 89 (escape min), 8278 (escape max),
         * 8279 (double-escape min), and a jump to the uint16 max.
         */
        const values = [0, 88, 177, 8455, 16_734, 65_535];
        roundTrip(new Uint16Array([...values, ...values, ...values]), 3);
    });

    it("should round-trip long consecutive runs (RLE chunking)", () => {
        /*
         * A run of 200 consecutive values spans multiple RLE chunks
         * (chunk cap is BASE + 1 = 92).
         */
        const values: number[] = [];
        for (let index = 0; index < 200; index++) values.push(index);
        for (let index = 0; index < 200; index++) values.push(index);
        roundTrip(new Uint16Array(values), 40);
    });

    it("should round-trip across the whole dictSize search grid", () => {
        const values: number[] = [];
        for (let index = 0; index < 500; index++) {
            values.push((index * 37) % 120, index % 60);
        }
        const data = new Uint16Array(values);
        for (let dictSize = 45; dictSize <= 75; dictSize++) {
            const result = tryEncodeWithSplit(data, dictSize);
            if (result === null) continue;
            const decoded = decodeTrieDict(
                result.encoded,
                data.length,
                result.atomCount,
                result.dict1AtomCount,
                result.ngramCount,
                result.dictSize,
            );
            expect(decoded).toStrictEqual(data);
        }
    });
});
