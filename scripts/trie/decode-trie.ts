import { BinTrieFlags } from "../../src/internal/bin-trie-flags.js";

export function decodeNode(
    decodeMap: number[],
    resultMap: Record<string, string>,
    prefix: string,
    startIndex: number,
): void {
    const current = decodeMap[startIndex];
    const valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;

    if (valueLength > 0) {
        // For single-char values, mask out all flag bits (value length bits + flag13)
        resultMap[prefix] =
            valueLength === 1
                ? String.fromCharCode(
                      decodeMap[startIndex] &
                          ~(BinTrieFlags.VALUE_LENGTH | BinTrieFlags.FLAG13),
                  )
                : valueLength === 2
                  ? String.fromCharCode(decodeMap[startIndex + 1])
                  : String.fromCharCode(
                        decodeMap[startIndex + 1],
                        decodeMap[startIndex + 2],
                    );
        if (current & BinTrieFlags.FLAG13) {
            // Only emit suffixed variant
            const suffixed = `${prefix};`;
            resultMap[suffixed] = resultMap[prefix];
            delete resultMap[prefix];
        }
    } else if (current & BinTrieFlags.FLAG13) {
        // Compact run: bits12..7 length (6 bits), bits6..0 first char.
        const runLength = (current & BinTrieFlags.BRANCH_LENGTH) >> 7; // 6 bits
        const firstChar = current & BinTrieFlags.JUMP_TABLE;
        let runPrefix = prefix + String.fromCharCode(firstChar);
        const remaining = runLength - 1;
        const packedWords = Math.ceil(remaining / 2);
        // Packed words start at startIndex+1
        for (let index = 0; index < packedWords; index++) {
            const packed = decodeMap[startIndex + 1 + index];
            const low = packed & 0xff;
            const high = (packed >> 8) & 0xff;
            const globalPos = 1 + 2 * index; // Position of low char in run (0-based within remaining)
            if (globalPos <= remaining) runPrefix += String.fromCharCode(low);
            if (globalPos + 1 <= remaining) {
                runPrefix += String.fromCharCode(high);
            }
        }
        // Recurse to final node after packed words
        decodeNode(
            decodeMap,
            resultMap,
            runPrefix,
            startIndex + 1 + packedWords,
        );
        return;
    }

    const branchLength = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
    const jumpOffset = current & BinTrieFlags.JUMP_TABLE;

    if (valueLength === 1 || (branchLength === 0 && jumpOffset === 0)) {
        return;
    }

    const branchIndex = startIndex + Math.max(valueLength, 1);

    if (branchLength === 0) {
        decodeNode(
            decodeMap,
            resultMap,
            prefix + String.fromCharCode(jumpOffset),
            branchIndex,
        );
        return;
    }

    if (jumpOffset === 0) {
        /*
         * Dictionary: Keys are packed (two per uint16). Treat packed keys as a virtual
         * sorted array of length `branchLength` where key(i) is the low (even i)
         * or high (odd i) byte of slot i>>1.
         */
        const packedKeySlots = Math.ceil(branchLength / 2);
        for (let keyIndex = 0; keyIndex < branchLength; keyIndex++) {
            const slot = keyIndex >> 1;
            const packed = decodeMap[branchIndex + slot];
            const key = (packed >> ((keyIndex & 1) * 8)) & 0xff;
            const destinationIndex = branchIndex + packedKeySlots + keyIndex;
            decodeNode(
                decodeMap,
                resultMap,
                prefix + String.fromCharCode(key),
                decodeMap[destinationIndex],
            );
        }
    } else {
        for (let index = 0; index < branchLength; index++) {
            const value = decodeMap[branchIndex + index] - 1;
            if (value !== -1) {
                const code = jumpOffset + index;

                decodeNode(
                    decodeMap,
                    resultMap,
                    prefix + String.fromCharCode(code),
                    value,
                );
            }
        }
    }
}
