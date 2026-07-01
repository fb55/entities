import * as assert from "node:assert";
import { BinTrieFlags } from "../../src/internal/bin-trie-flags.js";
import type { TrieNode } from "./trie.js";

/**
 * Determines the binary length of an integer.
 * @param integer Integer to encode using variable-length representation.
 */
function binaryLength(integer: number): number {
    return Math.floor(Math.log2(integer)) + 1;
}

/**
 * Encode a trie into compact binary representation.
 * @param trie Trie node map to encode.
 * @param maxJumpTableOverhead Maximum allowed jump-table overhead before
 *   using linear encoding — either a constant or a per-node function (used
 *   to give hot nodes a more generous threshold than cold ones).
 */
export function encodeTrie(
    trie: TrieNode,
    maxJumpTableOverhead: number | ((node: TrieNode) => number) = 2,
): number[] {
    const encodeCache = new Map<TrieNode, number>();
    const enc: number[] = [];
    const overheadForNode =
        typeof maxJumpTableOverhead === "function"
            ? maxJumpTableOverhead
            : () => maxJumpTableOverhead;

    function encodeNode(node: TrieNode): number {
        const cached = encodeCache.get(node);
        if (cached != null) return cached;
        const startIndex = enc.length;
        encodeCache.set(node, startIndex);
        enc.push(0);
        const nodeIndex = enc.length - 1;

        if (node.value != null) {
            let valueLength =
                node.next !== undefined ||
                node.value.length > 1 ||
                binaryLength(node.value.charCodeAt(0)) > 14 ||
                (node.value.charCodeAt(0) & BinTrieFlags.FLAG13) !== 0
                    ? node.value.length
                    : 0;
            valueLength += 1;
            assert.ok(
                binaryLength(valueLength) <= 2,
                "Too many bits for value length",
            );
            // Store value length in the VALUE_LENGTH bits (15..14)
            enc[nodeIndex] |= valueLength << 14; // (valueLength - 1) encoded via shift; mask defined in BinTrieFlags
            if (node.semiRequired) {
                enc[nodeIndex] |= BinTrieFlags.FLAG13;
            }
            if (valueLength === 1) {
                enc[nodeIndex] |= node.value.charCodeAt(0);
            } else {
                for (let index = 0; index < node.value.length; index++) {
                    enc.push(node.value.charCodeAt(index));
                }
            }
        }

        if (node.next) {
            if (node.value == null) {
                const runChars: number[] = [];
                let current: TrieNode | undefined = node;
                while (current.next && current.next.size === 1) {
                    const [char, child] = current.next.entries().next()
                        .value as [number, TrieNode];
                    runChars.push(char);
                    current = child;
                    if (
                        child.value != null ||
                        (child.next && child.next.size !== 1)
                    ) {
                        break;
                    }
                }
                // Only emit a compact run if length > 2 (ie, at least 3 chars)
                if (
                    runChars.length > 2 &&
                    (current.value != null ||
                        (current.next && current.next.size !== 1)) &&
                    !encodeCache.has(current)
                ) {
                    const runLength = runChars.length;
                    if (runLength > 63) {
                        addBranches(node, nodeIndex);
                        assert.strictEqual(nodeIndex, startIndex);
                        return startIndex;
                    }
                    const firstChar = runChars[0];
                    assert.ok(firstChar < 0x80, "run first char must be < 128");
                    /*
                     * FLAG13 with VALUE_LENGTH=0 marks a compact run (the
                     * same bit means "semicolon required" on value nodes).
                     * runLength fits the 6-bit BRANCH_LENGTH field — the
                     * `> 63` case bailed out above.
                     */
                    enc[nodeIndex] =
                        BinTrieFlags.FLAG13 | (runLength << 7) | firstChar;
                    for (let index = 1; index < runLength; index += 2) {
                        const low = runChars[index];
                        const high = runChars[index + 1];
                        enc.push(low | (high << 8));
                    }
                    encodeNode(current);
                    assert.strictEqual(nodeIndex, startIndex);
                    return startIndex;
                }
            }
            addBranches(node, nodeIndex);
        }

        assert.strictEqual(nodeIndex, startIndex, "Has expected location");
        return startIndex;
    }

    function addBranches(node: TrieNode, nodeIndex: number) {
        const branches = [...node.next!];
        if (branches.length === 0) return;
        branches.sort(([a], [b]) => a - b);
        assert.ok(
            binaryLength(branches.length) <= 6,
            "Too many bits for branches",
        );

        if (branches.length === 1 && !encodeCache.has(branches[0][1])) {
            const [char, child] = branches[0];
            assert.ok(binaryLength(char) <= 7, "Too many bits for single char");
            enc[nodeIndex] |= char;
            encodeNode(child);
            return;
        }
        const jumpOffset = branches[0][0];
        const jumpEndValue = branches[branches.length - 1][0];
        const jumpTableLength = jumpEndValue - jumpOffset + 1;
        const jumpTableOverhead = jumpTableLength / branches.length;
        // BRANCH_LENGTH is 6 bits → jumpTableLength must fit in 63 too.
        if (
            jumpTableOverhead <= overheadForNode(node) &&
            jumpTableLength <= 63
        ) {
            assert.ok(
                binaryLength(jumpOffset) <= 7,
                `Jump-table first char ${jumpOffset} needs ${binaryLength(
                    jumpOffset,
                )} bits but the JUMP_TABLE field is only 7`,
            );
            enc[nodeIndex] |= (jumpTableLength << 7) | jumpOffset;
            assert.ok(
                binaryLength(jumpTableLength) <= 6,
                `Too many bits (${binaryLength(jumpTableLength)}) for branches`,
            );
            for (let index = 0; index < jumpTableLength; index++) enc.push(0);
            const branchIndex = enc.length - jumpTableLength;
            const branchEnd = branchIndex + jumpTableLength;
            for (const [char, child] of branches) {
                const relativeIndex = char - jumpOffset;
                const pointerPos = branchIndex + relativeIndex;
                const childOffset = encodeNode(child);
                /*
                 * Store the offset relative to the END of the branch array,
                 * + 1 (0 = no branch sentinel). End-relative beats
                 * slot-relative for compression: the common "child encoded
                 * immediately after the table" case becomes the constant 1
                 * regardless of which slot points at it.
                 */
                const stored =
                    (childOffset - branchEnd + 1 + 0x1_00_00) % 0x1_00_00;
                assert.notStrictEqual(
                    stored,
                    0,
                    `Jump-table slot at ${pointerPos} (char ${char}) → child ${childOffset} encodes to 0, which collides with the no-branch sentinel.`,
                );
                enc[pointerPos] = stored;
            }
            return;
        }
        enc[nodeIndex] |= branches.length << 7;
        const packedKeySlots = (branches.length + 1) >> 1;
        const branchIndex = enc.length;
        enc.push(
            ...Array.from({ length: packedKeySlots }, () => 0),
            ...branches.map(() => Number.MAX_SAFE_INTEGER),
        );
        assert.strictEqual(
            enc.length,
            branchIndex + packedKeySlots + branches.length,
            "Did not reserve enough space",
        );
        const dictEnd = branchIndex + packedKeySlots + branches.length;
        for (const [index, [value, child]] of branches.entries()) {
            assert.ok(value < 128, "Branch value too large");
            const packedIndex = branchIndex + (index >> 1);
            enc[packedIndex] |= (index & 1) === 0 ? value : value << 8;
            const destinationIndex = branchIndex + packedKeySlots + index;
            assert.strictEqual(
                enc[destinationIndex],
                Number.MAX_SAFE_INTEGER,
                "Should have the placeholder as the destination element",
            );
            const offset = encodeNode(child);
            /*
             * Store the offset relative to the end of the branch data (see
             * the jump-table case above for why end-relative compresses
             * better than position-relative).
             */
            enc[destinationIndex] = (offset - dictEnd + 0x1_00_00) % 0x1_00_00;
        }
    }

    encodeNode(trie);
    assert.ok(
        enc.every(
            (v) => typeof v === "number" && v >= 0 && binaryLength(v) <= 16,
        ),
        "Too many bits",
    );
    return enc;
}
