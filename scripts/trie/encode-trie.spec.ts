import { BinTrieFlags } from "../../src/decode";
import { encodeTrie } from "./encode-trie";

describe("encode_trie", () => {
    it("should encode a trie", () => {
        expect(encodeTrie({})).toStrictEqual([0b0000_0000_0000_0000]);
        expect(encodeTrie({ value: "a" })).toStrictEqual([
            BinTrieFlags.HAS_VALUE,
            "a".charCodeAt(0),
        ]);
        expect(
            encodeTrie({
                next: new Map([["b".charCodeAt(0), { value: "a" }]]),
            })
        ).toStrictEqual([
            0b0000_0001_0000_0000,
            "b".charCodeAt(0),
            BinTrieFlags.HAS_VALUE,
            "a".charCodeAt(0),
        ]);
        const recursiveTrie = { next: new Map() };
        recursiveTrie.next.set("a".charCodeAt(0), { value: "a" });
        recursiveTrie.next.set("0".charCodeAt(0), recursiveTrie);
        expect(encodeTrie(recursiveTrie)).toStrictEqual([
            0b0000_0010_0000_0000,
            "0".charCodeAt(0),
            "a".charCodeAt(0),
            0,
            5,
            BinTrieFlags.HAS_VALUE,
            "a".charCodeAt(0),
        ]);

        const jumpRecursiveTrie = { next: new Map() };
        [48, 49, 52, 54, 56, 57].forEach((val) =>
            jumpRecursiveTrie.next.set(val, jumpRecursiveTrie)
        );
        expect(encodeTrie(jumpRecursiveTrie)).toStrictEqual([
            0b0000_1010_0001_0000, 0b1101, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1,
        ]);
    });
});
