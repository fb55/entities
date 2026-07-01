import { describe, expect, it } from "vitest";
import { encodeTrie } from "./encode-trie.js";
import type { TrieNode } from "./trie.js";

describe("encode_trie", () => {
    it("should encode an empty node", () => {
        expect(encodeTrie({})).toStrictEqual([0b0000_0000_0000_0000]);
    });

    it("should encode a node with an empty next map", () => {
        const trie = { next: new Map() };
        // This exercises the early return in addBranches when there are zero entries.
        expect(encodeTrie(trie)).toStrictEqual([0]);
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
        const trie = {
            next: new Map([["b".charCodeAt(0), { value: "a" }]]),
        };
        expect(encodeTrie(trie)).toStrictEqual([
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

        /*
         * Dictionary branch (2 entries: 'A'=65, 'b'=98). Keys packed two per
         * uint16 (low byte / high byte). nodeA is shared: both 'A' and 'c'
         * inside nodeC point to the same encoded node.
         *
         * [0] header:  branchCount=2 → 2<<7 = 256
         * [1] keys:    'A'(65) | ('b'(98)<<8)
         * [2] dest[0]: end-relative ptr → nodeA at index 4
         * [3] dest[1]: end-relative ptr → nodeC at index 5
         * [4] nodeA:   value "a" inline → 0x4000 | 97
         * [5] nodeC header: 1-slot jump table (single branch, but nodeA is
         *     already encoded so the inline single-branch form can't be used)
         *     → (1<<7) | jumpOffset 'c'(99)
         * [6] slot:    ptr → nodeA at index 4 (backwards, wraps via uint16)
         *
         * Dict pointers are relative to the end of the branch data
         * (branchIndex + packedKeySlots + branchCount = 1 + 1 + 2 = 4).
         */
        const result = encodeTrie(trie);

        expect(result).toHaveLength(7);
        // [0]: dictionary header with branchCount=2
        expect((result[0] >> 7) & 0x3f).toBe(2); // 2 branches
        expect(result[0] & 0x7f).toBe(0); // No jump offset → dictionary
        // [1]: packed keys 'A' in low byte, 'b' in high byte
        expect(result[1] & 0xff).toBe(65); // 'A'
        expect((result[1] >> 8) & 0xff).toBe(98); // 'b'
        // [4]: nodeA with inline value 'a'
        expect(result[4]).toBe(0b0100_0000_0000_0000 | 97);
        // [2],[3]: end-relative pointers that resolve to valid node indices
        expect((4 + result[2]) & 0xff_ff).toBe(4); // Dest[0] → nodeA
        expect((4 + result[3]) & 0xff_ff).toBe(5); // Dest[1] → nodeC
    });

    it("should encode a disjoint recursive branch", () => {
        const recursiveTrie: TrieNode = { next: new Map() };
        recursiveTrie.next!.set("a".charCodeAt(0), { value: "a" });
        recursiveTrie.next!.set("0".charCodeAt(0), recursiveTrie);

        /*
         * Dictionary branch (2 entries: '0'=48, 'a'=97).
         *
         * [0] header: branchCount=2 → 2<<7 = 256
         * [1] keys:   '0'(48) | ('a'(97)<<8) = 48 + 24832 = 24880
         * [2] dest[0]: end-relative ptr back to self at 0 → (0−4+0x10000)%0x10000 = 65532
         * [3] dest[1]: end-relative ptr to {value:"a"} at 4 → (4−4) = 0
         * [4] node:   value "a" (1-char, inline) → 0x4000 | 97 = 16481
         *
         * Branch data ends at index 4 (header + 1 key word + 2 pointers).
         */
        const result = encodeTrie(recursiveTrie);

        expect(result).toHaveLength(5);
        expect((result[0] >> 7) & 0x3f).toBe(2); // 2 branches
        // Packed keys: '0' low, 'a' high
        expect(result[1] & 0xff).toBe(48);
        expect((result[1] >> 8) & 0xff).toBe(97);
        // Dest[0] points back to self (index 0) — wraps around via uint16
        expect((4 + result[2]) & 0xff_ff).toBe(0);
        // Dest[1] points to the leaf node
        expect((4 + result[3]) & 0xff_ff).toBe(4);
        // Leaf: inline value 'a'
        expect(result[4]).toBe(0b0100_0000_0000_0000 | 97);
    });

    it("should encode a recursive branch to a jump map", () => {
        /*
         * Chars 48('0'), 49('1'), 52('4'), 54('6'), 56('8'), 57('9').
         * Range 48..57 = 10 slots for 6 entries → overhead 10/6 = 1.67 → jump table.
         *
         * Jump-table pointers are stored relative to the end of the branch
         * array (index 11 here), + 1 so that 0 stays the no-branch sentinel.
         */
        const leaf: TrieNode = { value: "a" };
        const jumpRecursiveTrie: TrieNode = { next: new Map() };
        jumpRecursiveTrie.next!.set(48, leaf);
        const selfReferenceChars = [49, 52, 54, 56, 57];
        for (const value of selfReferenceChars) {
            jumpRecursiveTrie.next!.set(value, jumpRecursiveTrie);
        }

        const result = encodeTrie(jumpRecursiveTrie);

        // 1 header + 10 jump-table slots + 1 leaf node = 12 words.
        expect(result).toHaveLength(12);
        expect((result[0] >> 7) & 0x3f).toBe(10); // Branch count = 10
        expect(result[0] & 0x7f).toBe(48); // Jump offset = '0'

        const slotFor = (char: number) => result[1 + (char - 48)];
        // Chars 50,51,53,55 (='2','3','5','7') have no branch → slot = 0.
        for (const char of [50, 51, 53, 55]) {
            expect(slotFor(char)).toBe(0);
        }

        // '0' resolves to the leaf node carrying value "a".
        const branchEnd = 11; // 1 header + 10 slots
        const leafStored = slotFor(48);
        expect(leafStored).not.toBe(0);
        const leafIndex = (branchEnd + leafStored - 1) & 0xff_ff;
        expect(result[leafIndex]).toBe(0b0100_0000_0000_0000 | 97);

        // Self-ref slots all resolve back to the root node (index 0).
        for (const char of selfReferenceChars) {
            const pointerPos = 1 + (char - 48);
            const stored = result[pointerPos];
            expect(stored).not.toBe(0); // Never the no-branch sentinel
            expect((branchEnd + stored - 1) & 0xff_ff).toBe(0);
        }
    });

    it("should encode adjacent jump-table self-refs without sentinel collision", () => {
        /*
         * Two adjacent self-refs → overhead 1, takes the jump-table path.
         * No stored pointer may equal 0, the "no branch" sentinel. With
         * end-relative pointers that collision is structurally impossible
         * (stored = 0 would require the child to start at the last slot of
         * the branch array itself); this pins the hazard case, the first
         * slot (pointerPos=1, childOffset=0).
         */
        const recursive: TrieNode = { next: new Map() };
        recursive.next!.set(48, recursive);
        recursive.next!.set(49, recursive);
        const result = encodeTrie(recursive);
        const branchEnd = 3; // 1 header + 2 slots
        for (const pointerPos of [1, 2]) {
            expect(result[pointerPos]).not.toBe(0);
            expect((branchEnd + result[pointerPos] - 1) & 0xff_ff).toBe(0);
        }
    });

    it("uses a jump table for a contiguous range of 63 children (the 6-bit BRANCH_LENGTH limit)", () => {
        /*
         * Span 63 equals branch count 63: fits both the jump-table length
         * field and the overhead budget, so the node is a jump table whose
         * header carries the first char in JUMP_TABLE and 63 in BRANCH_LENGTH.
         */
        const next = new Map<number, TrieNode>();
        for (let char = 1; char <= 63; char++) next.set(char, { value: "a" });
        const header = encodeTrie({ next })[0];
        // JUMP_TABLE field holds the first covered char.
        expect(header & 0b0111_1111).toBe(1);
        // BRANCH_LENGTH field holds the run length.
        expect((header >> 7) & 0b0011_1111).toBe(63);
    });

    it("falls back to a dictionary when the jump-table span exceeds 63 but the branch count fits", () => {
        /*
         * 63 children spanning 64 chars (one gap at 63): the branch count
         * still fits the 6-bit field, but the jump-table length (span) is 64,
         * so the `jumpTableLength <= 63` guard forces the dictionary encoding
         * (JUMP_TABLE field is 0).
         */
        const next = new Map<number, TrieNode>();
        for (let char = 1; char <= 62; char++) next.set(char, { value: "a" });
        // Gap at 63; char 64 makes the span 64.
        next.set(64, { value: "a" });
        const header = encodeTrie({ next })[0];
        // Dictionary node: JUMP_TABLE field is 0.
        expect(header & 0b0111_1111).toBe(0);
        // BRANCH_LENGTH field holds all 63 branches.
        expect((header >> 7) & 0b0011_1111).toBe(63);
    });

    it("cannot encode a node with 64 children (exceeds the 6-bit BRANCH_LENGTH field)", () => {
        /*
         * 64 overflows the 6-bit branch-count field for both the jump-table
         * and dictionary encodings, so encoding must fail loudly rather than
         * silently corrupt the header.
         */
        const next = new Map<number, TrieNode>();
        for (let char = 1; char <= 64; char++) next.set(char, { value: "a" });
        expect(() => encodeTrie({ next })).toThrow(
            "Too many bits for branches",
        );
    });
});
