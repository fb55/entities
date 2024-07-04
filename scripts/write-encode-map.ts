import htmlMap from "../maps/entities.json";
import { writeFileSync } from "node:fs";

interface TrieNode {
    /** The value, if the node has a value. */
    value?: string | undefined;
    /** A map with the next nodes, if there are any. */
    next?: Map<number, TrieNode> | undefined;
}

const htmlTrie = getTrie(htmlMap);
const serialized = serializeTrie(htmlTrie);

writeFileSync(
    new URL("../src/generated/encode-html.ts", import.meta.url),
    `// Generated using scripts/write-encode-map.ts

type EncodeTrieNode =
    | string
    | { v?: string; n: number | Map<number, EncodeTrieNode>; o?: string };

function restoreDiff<T extends ReadonlyArray<[number, EncodeTrieNode]>>(
    array: T
): T {
    for (let index = 1; index < array.length; index++) {
        array[index][0] += array[index - 1][0] + 1;
    }
    return array;
}

// prettier-ignore
export default ${
        // Fix the type of the first map to refer to trie nodes.
        serialized.replace("<number,string>", "<number,EncodeTrieNode>")
    };
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

function wrapValue(value: string | undefined): string {
    if (value == null) throw new Error("unexpected null");

    return `"&${value};"`;
}

function serializeTrie(trie: Map<number, TrieNode>): string {
    const entries: [number, TrieNode][] = [...trie.entries()].sort(
        (a, b) => a[0] - b[0],
    );

    return `/* #__PURE__ */ new Map<number,string>(/* #__PURE__ */restoreDiff([${entries
        .map(([key, value], index, array) => {
            if (index !== 0) {
                key -= array[index - 1][0] + 1;
            }
            if (!value.next) {
                if (value.value == null) throw new Error("unexpected null");

                return `[${key},${wrapValue(value.value)}]`;
            }

            const entries: string[] = [];

            if (value.value != null) {
                entries.push(`v:${wrapValue(value.value)}`);
            }

            /*
             * We encode branches as either a number with an `o` (other) value,
             * or as a map.
             *
             * We use a map if there are more than one character in the key.
             */
            if (value.next.size > 1) {
                entries.push(`n:${serializeTrie(value.next)}`);
            } else {
                const [condition, other] = [...value.next][0];

                entries.push(`n:${condition},o:${wrapValue(other.value)}`);
            }

            return `[${key},{${entries.join(",")}}]`;
        })
        .join(",")}]))`;
}
