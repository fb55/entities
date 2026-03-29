import { writeFileSync } from "node:fs";
import htmlMap from "../maps/entities.json" with { type: "json" };

interface TrieNode {
    value?: string | undefined;
    next?: Map<number, TrieNode> | undefined;
}

const htmlTrie = getTrie(htmlMap);

/*
 * Strip children from ASCII entries (0–127).  The encoder's ASCII fast path
 * uses a flat array lookup and never checks children, so multi-char entities
 * starting with ASCII chars (like < + U+20D2 → &nvlt;) are unreachable.
 * Removing them shrinks the serialized data without affecting behavior.
 * The parser routes ASCII leaf entries to a separate array via `asciiOut`.
 */
for (let index = 0; index < 128; index++) {
    const node = htmlTrie.get(index);
    if (node?.next) {
        if (node.value) {
            htmlTrie.set(index, { value: node.value });
        } else {
            htmlTrie.delete(index);
        }
    }
}

const serialized = serializeTrie(htmlTrie);

writeFileSync(
    new URL("../src/generated/encode-html.ts", import.meta.url),
    `// Generated using scripts/write-encode-map.ts

export default ${JSON.stringify(serialized)};
`,
);

console.log(`Done!  Data: ${serialized.length} chars`);

/**
 * Build the trie keyed by full Unicode code points (not UTF-16 char codes).
 *
 * This means astral characters (e.g. math script letters like 𝒜 = U+1D49C)
 * are stored as flat entries at their code point, instead of as children of
 * the high surrogate (U+D835).  This eliminates the large D835 surrogate
 * block and reduces the serialized data size significantly.
 * @param map
 */
function getTrie(map: Record<string, string>): Map<number, TrieNode> {
    const trie = new Map<number, TrieNode>();

    for (const entity of Object.keys(map)) {
        const decoded = map[entity];
        let lastMap = trie;

        // Walk all code points except the last one, creating intermediate nodes.
        let index = 0;
        while (index < decoded.length) {
            const cp = decoded.codePointAt(index)!;
            const cpLength = cp > 0xff_ff ? 2 : 1;

            // Check if this is the last code point in the sequence.
            if (index + cpLength >= decoded.length) break;

            const next = lastMap.get(cp) ?? {};
            lastMap.set(cp, next);
            lastMap = next.next ??= new Map();
            index += cpLength;
        }

        // Set the value on the final code point.
        const lastCP = decoded.codePointAt(index)!;
        const value = lastMap.get(lastCP) ?? {};
        if (!value.value || entity.length < value.value.length) {
            value.value = entity;
        }
        lastMap.set(lastCP, value);
    }

    return trie;
}

function serializeTrie(trie: Map<number, TrieNode>): string {
    // @ts-expect-error `toSorted` requires a lib bump.
    const entries = [...trie.entries()].toSorted(
        (a: [number, TrieNode], b: [number, TrieNode]) => a[0] - b[0],
    );
    let out = "";
    let lastKey = -1;
    for (const [key, node] of entries) {
        if (lastKey === -1) {
            out += key.toString(10);
        } else {
            const diff = key - lastKey - 1;
            if (diff !== 0) out += diff.toString(10);
        }
        if (node.value) out += `${node.value};`;
        if (node.next) {
            out += `{${serializeTrie(node.next)}}`;
        }
        lastKey = key;
    }
    return out;
}
