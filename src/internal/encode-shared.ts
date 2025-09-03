export type EncodeTrieNode =
    | string
    | { v?: string; n: number | Map<number, EncodeTrieNode>; o?: string };

/**
 * Parse a compact encode trie string into a Map structure used for encoding.
 *
 * Format per entry (ascending code points using delta encoding):
 *   <diffBase36>[&name;][{<children>}]  -- diff omitted when 0
 * Where diff = currentKey - previousKey - 1 (first entry stores absolute key).
 * `&name;` is the entity value (already wrapped); a following `{` denotes children.
 */
export function parseEncodeTrie(
    serialized: string,
): Map<number, EncodeTrieNode> {
    let index = 0;

    function parseEntries(
        terminator: string | null,
    ): Map<number, EncodeTrieNode> {
        const map = new Map<number, EncodeTrieNode>();
        let lastKey = -1;
        const totalLength = serialized.length;

        while (
            index < totalLength &&
            (terminator == null || serialized[index] !== terminator)
        ) {
            // Parse optional base36 diff (digits / a-z)
            let diff = 0;
            while (index < totalLength) {
                const code = serialized.charCodeAt(index);
                let value;
                if (code >= 48 && code <= 57) {
                    value = code - 48; // Digits 0-9
                } else if (code >= 97 && code <= 122) {
                    value = code - 87; // Letters a-z map to 10-35
                } else {
                    break;
                }
                diff = diff * 36 + value;
                index++;
            }

            const key = lastKey === -1 ? diff : lastKey + diff + 1;

            // Optional value
            let nodeValue: string | undefined;
            if (serialized[index] === "&") {
                index++;
                const start = index;
                while (index < totalLength && serialized[index] !== ";") {
                    index++;
                }
                nodeValue = `&${serialized.slice(start, index)};`;
                index++; // Skip ';'
            }

            let node: EncodeTrieNode;
            if (serialized[index] === "{") {
                index++; // Skip '{'
                const child = parseEntries("}");
                index++; // Skip '}'
                // Inline single-leaf optimization
                if (child.size === 1) {
                    const first = child.entries().next().value as [
                        number,
                        EncodeTrieNode,
                    ];
                    const [onlyKey, onlyNode] = first;
                    if (typeof onlyNode === "string") {
                        node = nodeValue
                            ? { v: nodeValue, n: onlyKey, o: onlyNode }
                            : { n: onlyKey, o: onlyNode };
                        map.set(key, node);
                        lastKey = key;
                        continue;
                    }
                }
                node = nodeValue ? { v: nodeValue, n: child } : { n: child };
            } else if (nodeValue) {
                node = nodeValue;
            } else {
                throw new Error(
                    `Malformed encode trie serialization near index ${index}`,
                );
            }

            map.set(key, node);
            lastKey = key;
        }

        return map;
    }

    return parseEntries(null);
}
