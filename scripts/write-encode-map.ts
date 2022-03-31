import htmlMap from "../maps/entities.json";
import { writeFileSync } from "fs";

interface TrieNode {
    /** The value, if the node has a value. */
    v?: string;
    /** A map with the next nodes, if there are any. */
    n?: Map<number, TrieNode>;
}

const htmlTrie = getTrie(htmlMap);
const serialized = serializeTrie(htmlTrie);

writeFileSync(
    `${__dirname}/../src/generated/encode-html.ts`,
    `// Generated using scripts/write-encode-map.ts
// prettier-ignore
export default ${serialized};
`
);

console.log("Done!");

function getTrie(map: Record<string, string>): Map<number, TrieNode> {
    const trie = new Map<number, TrieNode>();

    for (const entity of Object.keys(map)) {
        const decoded = map[entity];
        // Resolve the key
        let lastMap = trie;
        for (let i = 0; i < decoded.length - 1; i++) {
            const char = decoded.charCodeAt(i);
            const next = lastMap.get(char) ?? {};
            lastMap.set(char, next);
            lastMap = next.n ??= new Map();
        }
        const val = lastMap.get(decoded.charCodeAt(decoded.length - 1)) ?? {};
        val.v ??= entity;
        lastMap.set(decoded.charCodeAt(decoded.length - 1), val);
    }

    return trie;
}

function serializeTrie(trie: Map<number, TrieNode>): string {
    // eslint-disable-next-line node/no-unsupported-features/es-builtins
    const entries: [number, TrieNode][] = Array.from(trie.entries());

    return `new Map([${entries
        .map(
            ([key, value]) =>
                `[${key},{${[
                    value.v && `v:"&${value.v};"`,
                    value.n && `n:${serializeTrie(value.n)}`,
                ]
                    .filter(Boolean)
                    .join(",")}}]`
        )
        .join(",")}])`;
}
