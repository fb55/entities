import htmlMap from "../maps/entities.json";
import { writeFileSync } from "fs";

interface TrieNode {
    /** The value, if the node has a value. */
    v?: string | undefined;
    /** A map with the next nodes, if there are any. */
    n?: Map<number, TrieNode> | undefined;
}

const htmlTrie = getTrie(htmlMap);
const serialized = serializeTrie(htmlTrie);

writeFileSync(
    `${__dirname}/../src/generated/encode-html.ts`,
    `// Generated using scripts/write-encode-map.ts

type EncodeTrieNode =
    | string
    | { v?: string; n: number | Map<number, EncodeTrieNode>; o?: string };

function restoreDiff<T extends ReadonlyArray<[number, EncodeTrieNode]>>(
    arr: T
): T {
    for (let i = 1; i < arr.length; i++) {
        arr[i][0] += arr[i - 1][0] + 1;
    }
    return arr;
}

// prettier-ignore
export default ${
        // Fix the type of the first map to refer to trie nodes.
        serialized.replace("<number,string>", "<number,EncodeTrieNode>")
    };
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

function wrapValue(value: string | undefined): string {
    if (value == null) throw new Error("unexpected null");

    return `"&${value};"`;
}

function serializeTrie(trie: Map<number, TrieNode>): string {
    const entries: [number, TrieNode][] = Array.from(trie.entries()).sort(
        (a, b) => a[0] - b[0]
    );

    return `new Map<number,string>(/* #__PURE__ */restoreDiff([${entries
        .map(([key, value], i, arr) => {
            if (i !== 0) {
                key -= arr[i - 1][0] + 1;
            }
            if (!value.n) {
                if (value.v == null) throw new Error("unexpected null");

                return `[${key},${wrapValue(value.v)}]`;
            }

            const entries: string[] = [];

            if (value.v != null) {
                entries.push(`v:${wrapValue(value.v)}`);
            }

            /*
             * We encode branches as either a number with an `o` (other) value,
             * or as a map.
             *
             * We use a map if there are more than one character in the key.
             */
            if (value.n.size > 1) {
                entries.push(`n:${serializeTrie(value.n)}`);
            } else {
                const [cond, other] = Array.from(value.n)[0];

                entries.push(`n:${cond},o:${wrapValue(other.v)}`);
            }

            return `[${key},{${entries.join(",")}}]`;
        })
        .join(",")}]))`;
}
