enum BinTrieFlags {
    VALUE_LENGTH = 0b1100_0000_0000_0000,
    BRANCH_LENGTH = 0b0011_1111_1000_0000,
    JUMP_TABLE = 0b0000_0000_0111_1111,
}

export function decodeNode(
    decodeMap: number[],
    resultMap: Record<string, string>,
    prefix: string,
    startIndex: number
): void {
    const current = decodeMap[startIndex];
    const valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;

    if (valueLength > 0) {
        resultMap[prefix] =
            valueLength === 1
                ? String.fromCharCode(
                      decodeMap[startIndex] & ~BinTrieFlags.VALUE_LENGTH
                  )
                : valueLength === 2
                ? String.fromCharCode(decodeMap[startIndex + 1])
                : String.fromCharCode(
                      decodeMap[startIndex + 1],
                      decodeMap[startIndex + 2]
                  );
    }

    const branchLength = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
    const jumpOffset = current & BinTrieFlags.JUMP_TABLE;

    if (valueLength === 1 || (branchLength === 0 && jumpOffset === 0)) {
        return;
    }

    const branchIdx = startIndex + Math.max(valueLength, 1);

    if (branchLength === 0) {
        return decodeNode(
            decodeMap,
            resultMap,
            prefix + String.fromCharCode(jumpOffset),
            branchIdx
        );
    }

    if (jumpOffset !== 0) {
        for (let i = 0; i < branchLength; i++) {
            const val = decodeMap[branchIdx + i] - 1;
            if (val !== -1) {
                const code = jumpOffset + i;

                decodeNode(
                    decodeMap,
                    resultMap,
                    prefix + String.fromCharCode(code),
                    val
                );
            }
        }
    } else {
        for (let i = 0; i < branchLength; i++) {
            decodeNode(
                decodeMap,
                resultMap,
                prefix + String.fromCharCode(decodeMap[branchIdx + i]),
                decodeMap[branchIdx + branchLength + i]
            );
        }
    }
}
