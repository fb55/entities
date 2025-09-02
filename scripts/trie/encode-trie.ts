import * as assert from "node:assert";
import type { TrieNode } from "./trie.js";
import { BinTrieFlags } from "../../src/internal/bin-trie-flags.js";

/**
 * Determines the binary length of an integer.
 */
function binaryLength(integer: number): number {
    return Math.ceil(Math.log2(integer));
}

export function encodeTrie(
    trie: TrieNode,
    maxJumpTableOverhead = 2,
    stats?: {
        runCandidates?: number;
        runsEmitted?: number;
        rejectedFinalEncoded?: number;
        rejectedNotBeneficial?: number;
        rejectedTooLong?: number;
        rejectedLegacy?: number;
    },
): number[] {
    const encodeCache = new Map<TrieNode, number>();
    const enc: number[] = [];

    function encodeNode(node: TrieNode): number {
        const cached = encodeCache.get(node);
        if (cached != null) return cached;
        const startIndex = enc.length;
        encodeCache.set(node, startIndex);
        const nodeIndex = enc.push(0) - 1;

        if (node.value != null) {
            let valueLength = 0;
            if (
                node.next !== undefined ||
                node.value.length > 1 ||
                binaryLength(node.value.charCodeAt(0)) > 14 ||
                (node.value.charCodeAt(0) & BinTrieFlags.FLAG13) !== 0
            ) {
                valueLength = node.value.length;
            }
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
                        (current.next && current.next.size !== 1))
                ) {
                    if (stats) {
                        stats.runCandidates = (stats.runCandidates ?? 0) + 1;
                    }
                    if (!encodeCache.has(current)) {
                        const semicolonCode = ";".charCodeAt(0);
                        if (
                            current.next?.has(semicolonCode) &&
                            current.value ===
                                current.next.get(semicolonCode)?.value
                        ) {
                            if (stats) {
                                stats.rejectedLegacy =
                                    (stats.rejectedLegacy ?? 0) + 1;
                            }
                            addBranches(node.next, nodeIndex);
                            assert.strictEqual(nodeIndex, startIndex);
                            return startIndex;
                        }
                        const runLength = runChars.length;
                        if (runLength > 63) {
                            addBranches(node.next, nodeIndex);
                            assert.strictEqual(nodeIndex, startIndex);
                            return startIndex;
                        }
                        const firstChar = runChars[0];
                        assert.ok(
                            firstChar < 0x80,
                            "run first char must be < 128",
                        );
                        const maskedRunLength = runLength & 0x3f;
                        enc[nodeIndex] =
                            BinTrieFlags.FLAG13 | // Compact run flag (same bit position)
                            (maskedRunLength << 7) |
                            firstChar;
                        for (let index = 1; index < runLength; index += 2) {
                            const low = runChars[index];
                            const high = runChars[index + 1];
                            enc.push(low | (high << 8));
                        }
                        encodeNode(current);
                        if (stats) {
                            stats.runsEmitted = (stats.runsEmitted ?? 0) + 1;
                        }
                        assert.strictEqual(nodeIndex, startIndex);
                        return startIndex;
                    }
                    if (stats) {
                        stats.rejectedFinalEncoded =
                            (stats.rejectedFinalEncoded ?? 0) + 1;
                    }
                }
            }
            addBranches(node.next, nodeIndex);
        }

        assert.strictEqual(nodeIndex, startIndex, "Has expected location");
        return startIndex;
    }

    function addBranches(next: Map<number, TrieNode>, nodeIndex: number) {
        const branches = [...next.entries()];
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
        if (jumpTableOverhead <= maxJumpTableOverhead) {
            assert.ok(
                binaryLength(jumpOffset) <= 16,
                `Offset ${jumpOffset} too large at ${binaryLength(jumpOffset)}`,
            );
            enc[nodeIndex] |= (jumpTableLength << 7) | jumpOffset;
            assert.ok(
                binaryLength(jumpTableLength) <= 7,
                `Too many bits (${binaryLength(jumpTableLength)}) for branches`,
            );
            for (let index = 0; index < jumpTableLength; index++) enc.push(0);
            const branchIndex = enc.length - jumpTableLength;
            for (const [char, child] of branches) {
                const relativeIndex = char - jumpOffset;
                enc[branchIndex + relativeIndex] = encodeNode(child) + 1;
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
            assert.ok(binaryLength(offset) <= 16, "Too many bits for offset");
            enc[destinationIndex] = offset;
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
