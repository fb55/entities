import * as assert from "node:assert";
import type { TrieNode } from "./trie.js";

/**
 * Determines the binary length of an integer.
 */
function binaryLength(integer: number): number {
    return Math.ceil(Math.log2(integer));
}

/**
 * Encodes the trie in binary form.
 *
 * We have three different types of nodes:
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

    function encodeNode(node: TrieNode): number {
        // Cache nodes, as we can have loops
        const cached = encodeCache.get(node);
        if (cached != null) return cached;

        const startIndex = enc.length;

        encodeCache.set(node, startIndex);

        const nodeIndex = enc.push(0) - 1;

        if (node.value != null) {
            let valueLength = 0;

            /*
             * If we don't have a branch and the value is short, we can
             * store the value in the node.
             */
            if (
                node.next !== undefined ||
                node.value.length > 1 ||
                binaryLength(node.value.charCodeAt(0)) > 14
            ) {
                valueLength = node.value.length;
            }

            // Add 1 to the value length, to signal that we have a value.
            valueLength += 1;

            assert.ok(
                binaryLength(valueLength) <= 2,
                "Too many bits for value length",
            );

            enc[nodeIndex] |= valueLength << 14;

            if (valueLength === 1) {
                enc[nodeIndex] |= node.value.charCodeAt(0);
            } else {
                for (let index = 0; index < node.value.length; index++) {
                    enc.push(node.value.charCodeAt(index));
                }
            }
        }

        if (node.next) addBranches(node.next, nodeIndex);

        assert.strictEqual(nodeIndex, startIndex, "Has expected location");

        return startIndex;
    }

    function addBranches(next: Map<number, TrieNode>, nodeIndex: number) {
        const branches = [...next.entries()];

        // Sort branches ASC by key
        branches.sort(([a], [b]) => a - b);

        assert.ok(
            binaryLength(branches.length) <= 6,
            "Too many bits for branches",
        );

        // If we only have a single branch, we can write the next value directly
        if (branches.length === 1 && !encodeCache.has(branches[0][1])) {
            const [char, next] = branches[0];

            assert.ok(binaryLength(char) <= 7, "Too many bits for single char");

            enc[nodeIndex] |= char;
            encodeNode(next);
            return;
        }

        const branchIndex = enc.length;

        // If we have consecutive branches, we can write the next value as a jump table

        /*
         * First, we determine how much space adding the jump table adds.
         *
         * If it is more than 2x the number of branches (which is equivalent
         * to the size of the dictionary), skip it.
         */

        const jumpOffset = branches[0][0];
        const jumpEndValue = branches[branches.length - 1][0];

        const jumpTableLength = jumpEndValue - jumpOffset + 1;

        const jumpTableOverhead = jumpTableLength / branches.length;

        if (jumpTableOverhead <= maxJumpTableOverhead) {
            assert.ok(
                binaryLength(jumpOffset) <= 16,
                `Offset ${jumpOffset} too large at ${binaryLength(jumpOffset)}`,
            );

            // Write the length of the adjusted table, plus jump offset
            enc[nodeIndex] |= (jumpTableLength << 7) | jumpOffset;

            assert.ok(
                binaryLength(jumpTableLength) <= 7,
                `Too many bits (${binaryLength(jumpTableLength)}) for branches`,
            );

            // Reserve space for the jump table
            for (let index = 0; index < jumpTableLength; index++) enc.push(0);

            // Write the jump table
            for (const [char, next] of branches) {
                const index = char - jumpOffset;
                // Write all values + 1, so 0 will result in a -1 when decoding
                enc[branchIndex + index] = encodeNode(next) + 1;
            }

            return;
        }

        enc[nodeIndex] |= branches.length << 7;

        enc.push(
            ...branches.map(([char]) => char),
            // Reserve space for destinations, using a value that is out of bounds
            ...branches.map((_) => Number.MAX_SAFE_INTEGER),
        );

        assert.strictEqual(
            enc.length,
            branchIndex + branches.length * 2,
            "Did not reserve enough space",
        );

        // Encode the branches
        for (const [index, [value, next]] of branches.entries()) {
            assert.ok(value < 128, "Branch value too large");

            const currentIndex = branchIndex + branches.length + index;
            assert.strictEqual(
                enc[currentIndex - branches.length],
                value,
                "Should have the value as the first element",
            );
            assert.strictEqual(
                enc[currentIndex],
                Number.MAX_SAFE_INTEGER,
                "Should have the placeholder as the second element",
            );
            const offset = encodeNode(next);

            assert.ok(binaryLength(offset) <= 16, "Too many bits for offset");
            enc[currentIndex] = offset;
        }
    }

    encodeNode(trie);

    // Make sure that every value fits in a UInt16
    assert.ok(
        enc.every(
            (value) =>
                typeof value === "number" &&
                value >= 0 &&
                binaryLength(value) <= 16,
        ),
        "Too many bits",
    );

    return enc;
}
