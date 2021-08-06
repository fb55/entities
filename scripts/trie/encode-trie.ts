/* eslint-disable node/no-unsupported-features/es-builtins */

import * as assert from "assert";
import { BinTrieFlags, JUMP_OFFSET_BASE } from "../../src/decode";
import { TrieNode } from "./trie";

function binaryLength(num: number) {
    return Math.ceil(Math.log2(num));
}

/**
 * Encodes the trie in binary form.
 *
 * We have four different types of nodes:
 * - Postfixes are ASCII values that match a particular character
 * - Values are UNICODE values that an entity resolves to
 * - Branches can be:
 *      1. If size is 1, then a matching character followed by the destination
 *      2. Two successive tables: characters and destination pointers.
 *          Characters have to be binary-searched to get the index of the destination pointer.
 *      3. A jump table: For each character, the destination pointer is stored in a jump table.
 * - Records have a value greater than 128 (the max ASCII value). Their format is 8 bits main data, 8 bits supplemental data:
 *   (
 *      1 bit has has value flag
 *      7 bit branch length if this is a branch — needs to be here to ensure value is >128 with a branch
 *      1 bit data is multi-byte
 *      7 bit branch jump table offset (if branch is a jump table)
 *   )
 *
 */
export function encodeTrie(trie: TrieNode, maxJumpTableOverhead = 2): number[] {
    const encodeCache = new Map<TrieNode, number>();
    const enc: number[] = [];

    function encodeNode(node: TrieNode, depth: number): number {
        // Cache nodes, as we can have loops
        const cached = encodeCache.get(node);
        if (cached != null) return cached;

        const startIndex = enc.length;

        encodeCache.set(node, startIndex);

        if (node.postfix != null) {
            for (let i = 0; i < node.postfix.length; i++) {
                const char = node.postfix.charCodeAt(i);

                assert.ok(char < 128, "Char not in range");

                // Start record with the postfix, as we have to match this first.
                enc.push(char);
            }
        }

        const nodeIdx = enc.push(0) - 1;

        if (node.value != null) {
            enc[nodeIdx] |= BinTrieFlags.HAS_VALUE;

            if (node.value.length === 2) {
                enc[nodeIdx] |= BinTrieFlags.MULTI_BYTE;
            }

            for (let i = 0; i < node.value.length; i++)
                enc.push(node.value.charCodeAt(i));
        }

        if (node.next) addBranches(node.next, nodeIdx, depth + 1);

        assert.strictEqual(
            nodeIdx,
            startIndex + (node.postfix?.length ?? 0),
            "Has expected location"
        );

        return startIndex;
    }

    function addBranches(
        next: Map<number, TrieNode>,
        nodeIdx: number,
        depth: number
    ) {
        const branches = Array.from(next.entries());

        // Sort branches ASC by key
        branches.sort(([a], [b]) => a - b);

        assert.ok(
            binaryLength(branches.length) <= 6,
            "Too many bits for branches"
        );

        // If we only have a single branch, we can write the next value directly
        if (branches.length === 1 && !encodeCache.has(branches[0][1])) {
            enc[nodeIdx] |= branches.length << 8; // Write the length of the branch

            const [[char, next]] = branches;
            enc.push(char);
            encodeNode(next, depth);
            return;
        }

        const branchIndex = enc.length;

        // If we have consecutive branches, we can write the next value as a jump table

        /*
         * First, we determine how much overhead adding the jump table adds.
         * If it is more than 2.5x, skip it.
         *
         * TODO: Determine best value
         */

        const jumpStartValue = branches[0][0];
        const jumpEndValue = branches[branches.length - 1][0];

        const jumpTableLength = jumpEndValue - jumpStartValue + 1;

        const jumpTableOverhead = jumpTableLength / branches.length;

        if (jumpTableOverhead <= maxJumpTableOverhead) {
            const jumpOffset = jumpStartValue - JUMP_OFFSET_BASE;

            assert.ok(
                binaryLength(jumpOffset) <= 16,
                `Offset ${jumpOffset} too large at ${binaryLength(jumpOffset)}`
            );

            // Write the length of the adjusted table, plus jump offset
            enc[nodeIdx] |= (jumpTableLength << 8) | jumpOffset;

            assert.ok(
                binaryLength(jumpTableLength) <= 7,
                `Too many bits (${binaryLength(jumpTableLength)}) for branches`
            );

            // Reserve space for the jump table
            for (let i = 0; i < jumpTableLength; i++) enc.push(0);

            // Write the jump table
            for (let i = 0; i < branches.length; i++) {
                const [char, next] = branches[i];
                const index = char - jumpStartValue;
                // Write all values + 1, so 0 will result in a -1 when decoding
                enc[branchIndex + index] = encodeNode(next, depth) + 1;
            }

            return;
        }

        enc[nodeIdx] |= branches.length << 8;

        enc.push(
            ...branches.map(([char]) => char),
            // Reserve space for destinations, using a value that is out of bounds
            ...branches.map((_) => Number.MAX_SAFE_INTEGER)
        );

        assert.strictEqual(
            enc.length,
            branchIndex + branches.length * 2,
            "Did not reserve enough space"
        );

        // Encode the branches
        branches.forEach(([val, next], idx) => {
            assert.ok(val < 128, "Branch value too large");

            const currentIndex = branchIndex + branches.length + idx;
            assert.strictEqual(
                enc[currentIndex - branches.length],
                val,
                "Should have the value as the first element"
            );
            assert.strictEqual(
                enc[currentIndex],
                Number.MAX_SAFE_INTEGER,
                "Should have the placeholder as the second element"
            );
            const offset = encodeNode(next, depth);

            assert.ok(binaryLength(offset) <= 16, "Too many bits for offset");
            enc[currentIndex] = offset;
        });
    }

    encodeNode(trie, 0);

    // Make sure that every value fits in a UInt16
    assert.ok(
        enc.every(
            (val) =>
                typeof val === "number" && val >= 0 && binaryLength(val) <= 16
        ),
        "Too many bytes"
    );

    return enc;
}
