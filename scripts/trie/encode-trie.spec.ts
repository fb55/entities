import { encodeTrie } from "./encode-trie.js";
import type { TrieNode } from "./trie.js";

describe("encode_trie", () => {
    it("should encode an empty node", () => {
        expect(encodeTrie({})).toStrictEqual([0b0000_0000_0000_0000]);
    });

    it("should encode a node with a value", () => {
        expect(encodeTrie({ value: "a" })).toStrictEqual([
            0b0100_0000_0000_0000 | "a".charCodeAt(0),
        ]);
    });

    it("should encode a node with a multi-byte value", () => {
        expect(encodeTrie({ value: "ab" })).toStrictEqual([
            0b1100_0000_0000_0000,
            "a".charCodeAt(0),
            "b".charCodeAt(0),
        ]);
    });

    it("should encode a branch of size 1", () => {
        expect(
            encodeTrie({
                next: new Map([["b".charCodeAt(0), { value: "a" }]]),
            })
        ).toStrictEqual([
            "b".charCodeAt(0),
            0b0100_0000_0000_0000 | "a".charCodeAt(0),
        ]);
    });

    it("should encode a branch of size 1 with a value that's already encoded", () => {
        const nodeA: TrieNode = { value: "a" };
        const nodeC = { next: new Map([["c".charCodeAt(0), nodeA]]) };
        const trie = {
            next: new Map<number, TrieNode>([
                ["A".charCodeAt(0), nodeA],
                ["b".charCodeAt(0), nodeC],
            ]),
        };
        expect(encodeTrie(trie)).toStrictEqual([
            0b0000_0001_0000_0000,
            "A".charCodeAt(0),
            "b".charCodeAt(0),
            0b101,
            0b110,
            0b0100_0000_0000_0000 | "a".charCodeAt(0),
            0b0000_0000_1000_0000 | "c".charCodeAt(0),
            0b110, // Index plus one
        ]);
    });

    it("should encode a disjoint recursive branch", () => {
        const recursiveTrie = { next: new Map() };
        recursiveTrie.next.set("a".charCodeAt(0), { value: "a" });
        recursiveTrie.next.set("0".charCodeAt(0), recursiveTrie);
        expect(encodeTrie(recursiveTrie)).toStrictEqual([
            0b0000_0001_0000_0000,
            "0".charCodeAt(0),
            "a".charCodeAt(0),
            0,
            5,
            0b0100_0000_0000_0000 | "a".charCodeAt(0),
        ]);
    });

    it("should encode a recursive branch to a jump map", () => {
        const jumpRecursiveTrie = { next: new Map() };
        [48, 49, 52, 54, 56, 57].forEach((val) =>
            jumpRecursiveTrie.next.set(val, jumpRecursiveTrie)
        );
        expect(encodeTrie(jumpRecursiveTrie)).toStrictEqual([
            0b0000_0101_0011_0000, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1,
        ]);
    });
});
