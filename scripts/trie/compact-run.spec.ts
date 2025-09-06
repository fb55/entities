import { describe, expect, it } from "vitest";
import { BinTrieFlags } from "../../src/internal/bin-trie-flags.js";
import { decodeNode } from "./decode-trie.js";
import { encodeTrie } from "./encode-trie.js";
import type { TrieNode } from "./trie.js";

function decode(map: number[]) {
    const out: Record<string, string> = {};
    decodeNode(map, out, "", 0);
    return out;
}

describe("compact_run", () => {
    it("encodes a standard compact run", () => {
        const trie = {
            next: new Map([
                [
                    "a".charCodeAt(0),
                    {
                        next: new Map([
                            [
                                "b".charCodeAt(0),
                                {
                                    next: new Map([
                                        [
                                            "c".charCodeAt(0),
                                            {
                                                next: new Map([
                                                    [
                                                        "d".charCodeAt(0),
                                                        { value: "X" },
                                                    ],
                                                ]),
                                            },
                                        ],
                                    ]),
                                },
                            ],
                        ]),
                    },
                ],
            ]),
        };
        const enc = encodeTrie(trie);
        // Standard run header: run flag + length(4)<<7 + first char 'a'
        const header = enc[0];
        expect(header & BinTrieFlags.FLAG13).not.toBe(0); // Run flag set
        expect(header & 0b0001_0000_0000_0000).toBe(0); // No inline flag anymore
        const runLength = (header >> 7) & 0x3f; // 6 bits
        expect(runLength).toBe(4);
        expect(header & 0x7f).toBe("a".charCodeAt(0));
        const decoded = decode(enc);
        expect(decoded).toHaveProperty("abcd", "X");
    });

    it("falls back to normal branches when run too short", () => {
        const trie = {
            next: new Map([["a".charCodeAt(0), { value: "X" }]]),
        };
        const enc = encodeTrie(trie);
        expect(enc[0] & BinTrieFlags.FLAG13).toBe(0); // Not a run
        expect(decode(enc)).toStrictEqual({ a: "X" });
    });

    it("falls back when run longer than 63 characters", () => {
        // Build a chain of 64 ASCII characters (codes 48..111) so runLength === 64 (>63)
        const root: TrieNode = { next: new Map() };
        let cursor: TrieNode = root;
        const chars: number[] = Array.from(
            { length: 64 },
            (_, index) => 48 + index,
        ); // '0'..'o'
        for (let index = 0; index < chars.length; index++) {
            const code = chars[index];
            const child: TrieNode =
                index === chars.length - 1
                    ? { value: "X" }
                    : { next: new Map() };
            cursor.next!.set(code, child);
            cursor = child;
        }
        const enc = encodeTrie(root);
        // Should not emit compact run header due to length >63
        expect(enc[0] & BinTrieFlags.FLAG13).toBe(0);
        const key = String.fromCharCode(...chars);
        expect(decode(enc)).toHaveProperty(key, "X");
    });
});
