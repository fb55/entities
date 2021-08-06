import { BinTrieFlags } from "../../src/decode";
import { encodeTrie } from "./encode-trie";

describe("encode_trie", () => {
    it("should encode an empty node", () => {
        expect(encodeTrie({})).toStrictEqual([0b0000_0000_0000_0000]);
    });

    it("should encode a node with a value", () => {
        expect(encodeTrie({ value: "a" })).toStrictEqual([
            BinTrieFlags.HAS_VALUE,
            "a".charCodeAt(0),
        ]);
    });

    it("should encode a node with a multi-byte value", () => {
        expect(encodeTrie({ value: "ab" })).toStrictEqual([
            BinTrieFlags.HAS_VALUE | BinTrieFlags.MULTI_BYTE,
            "a".charCodeAt(0),
            "b".charCodeAt(0),
        ]);
    });

    it("should encode a node with a value and a postfix", () => {
        expect(encodeTrie({ value: "a", postfix: "bc" })).toStrictEqual([
            "b".charCodeAt(0),
            "c".charCodeAt(0),
            BinTrieFlags.HAS_VALUE,
            "a".charCodeAt(0),
        ]);
    });

    it("should encode a branch of size 1", () => {
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
    });

    it("should encode a disjoint recursive branch", () => {
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
    });

    it("should encode a recursive branch to a jump map", () => {
        const jumpRecursiveTrie = { next: new Map() };
        [48, 49, 52, 54, 56, 57].forEach((val) =>
            jumpRecursiveTrie.next.set(val, jumpRecursiveTrie)
        );
        expect(encodeTrie(jumpRecursiveTrie)).toStrictEqual([
            0b0000_1010_0000_0001, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1,
        ]);
    });
});
