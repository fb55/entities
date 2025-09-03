import htmlMap from "../maps/entities.json" with { type: "json" };
import { writeFileSync } from "node:fs";

interface TrieNode {
    /** The value, if the node has a value. */
    value?: string | undefined;
    /** A map with the next nodes, if there are any. */
    next?: Map<number, TrieNode> | undefined;
}

const htmlTrie = getTrie(htmlMap);
const serialized = serializeTrieToString(htmlTrie);

writeFileSync(
    new URL("../src/generated/encode-html.ts", import.meta.url),
    `// Generated using scripts/write-encode-map.ts
// This file contains a compact, single-string serialization of the HTML encode trie.
// Format per entry (sequence in ascending code point order using diff encoding):
//   <diffBase36>[&name;][{<children>}]  -- diff omitted when 0.
// "&name;" gives the entity value for the node. A following { starts a nested sub-map.
// Diffs use the same scheme as before: diff = currentKey - previousKey - 1, first entry stores key.

import {
    parseEncodeTrie,
    type EncodeTrieNode,
} from "../internal/encode-shared.js";

// Compact serialized trie (intended to stay small & JS engine friendly)
export const htmlTrie: Map<number, EncodeTrieNode> =
    /* #__PURE__ */ parseEncodeTrie(
        ${JSON.stringify(serialized)},
    );
`,
);

console.log("Done!");

function getTrie(map: Record<string, string>): Map<number, TrieNode> {
    const trie = new Map<number, TrieNode>();

    for (const entity of Object.keys(map)) {
        const decoded = map[entity];
        // Resolve the key
        let lastMap = trie;
        for (let index = 0; index < decoded.length - 1; index++) {
            const char = decoded.charCodeAt(index);
            const next = lastMap.get(char) ?? {};
            lastMap.set(char, next);
            lastMap = next.next ??= new Map();
        }
        const value = lastMap.get(decoded.charCodeAt(decoded.length - 1)) ?? {};
        value.value ??= entity;
        lastMap.set(decoded.charCodeAt(decoded.length - 1), value);
    }

    return trie;
}

function serializeTrieToString(trie: Map<number, TrieNode>): string {
    const entries = [...trie.entries()].sort((a, b) => a[0] - b[0]);
    let out = "";
    let lastKey = -1;
    for (const [key, node] of entries) {
        if (lastKey === -1) {
            out += key.toString(36);
        } else {
            const diff = key - lastKey - 1;
            if (diff !== 0) out += diff.toString(36);
        }
        if (node.value) out += `&${node.value};`;
        if (node.next) {
            if (node.next.size === 1) {
                // Child optimization handled at parse time; no special serialization needed.
                const [, childNode] = [...node.next.entries()][0];
                if (!childNode.next && childNode.value) {
                    // Leave as normal block.
                }
            }
            out += `{${serializeTrieToString(node.next)}}`;
        } else if (!node.value) {
            throw new Error("Invalid node: neither value nor next");
        }
        lastKey = key;
    }
    return out;
}
