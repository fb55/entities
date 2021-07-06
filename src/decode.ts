import entityMap from "./maps/entities.json";
import legacyMap from "./maps/legacy.json";
import xmlMap from "./maps/xml.json";
import decodeCodePoint from "./decode_codepoint";

interface TrieNode {
    value?: string;
    legacy?: boolean;
    next?: Map<string, TrieNode>;
}

const numStart: TrieNode = (function () {
    type RecursiveMap = Map<string, TrieNode>;
    const numStart: RecursiveMap = new Map();

    const numRecurse: RecursiveMap = new Map();
    const numValue = { next: numRecurse, legacy: true };

    for (let i = 0; i <= 9; i++) {
        numStart.set(i.toString(10), numValue);
        numRecurse.set(i.toString(10), numValue);
    }

    const hexRecurse: RecursiveMap = new Map();
    const hexValue = { next: hexRecurse, legacy: true };
    for (let i = 0; i <= 15; i++) {
        hexRecurse.set(i.toString(16), hexValue);
        hexRecurse.set(i.toString(16).toUpperCase(), hexValue);
    }

    const hexStartValue = { next: hexRecurse };
    numStart.set("x", hexStartValue);
    numStart.set("X", hexStartValue);

    return { next: numStart };
})();

function getTrieReplacer(trie: Map<string, TrieNode>, legacyEntities: boolean) {
    return (str: string) => {
        let ret = "";
        let lastIdx = 0;
        let idx = 0;
        while ((idx = str.indexOf("&", idx)) >= 0) {
            const start = idx;
            let trieNode: TrieNode | undefined = { next: trie };
            let prevMap: TrieNode = trieNode;
            while (trieNode?.next) {
                prevMap = trieNode;
                trieNode = trieNode.next.get(str.charAt(++idx));
            }
            if (trieNode === undefined) {
                const isTerminated = str.charAt(idx) === ";";
                if (
                    str.charAt(start + 1) === "#" &&
                    (legacyEntities || isTerminated)
                ) {
                    const secondChar = str.charAt(start + 2);
                    const codePoint =
                        secondChar === "x" || secondChar === "X"
                            ? parseInt(str.slice(start + 3, idx), 16)
                            : parseInt(str.slice(start + 2, idx), 10);
                    ret +=
                        str.slice(lastIdx, start) + decodeCodePoint(codePoint);
                    lastIdx = idx += Number(isTerminated);
                } else if (
                    (legacyEntities && prevMap.legacy) ||
                    (isTerminated && prevMap.value !== undefined)
                ) {
                    ret += str.slice(lastIdx, start) + prevMap.value;
                    lastIdx = idx += Number(isTerminated);
                }
                continue;
            }

            ret += str.slice(lastIdx, start) + trieNode.value;
            lastIdx = idx += 2;
        }

        return ret + str.slice(lastIdx);
    };
}

export const decodeXML = getTrieReplacer(getTrie(xmlMap), false);
const htmlTrie = markLegacyEntries(getTrie(entityMap), legacyMap);
export const decodeHTMLStrict = getTrieReplacer(htmlTrie, false);
export const decodeHTML = getTrieReplacer(htmlTrie, true);

function getTrie(map: Record<string, string>) {
    const trie = new Map<string, TrieNode>();

    for (const key of Object.keys(map)) {
        // Resolve the key
        let lastMap = trie;
        for (const char of key.slice(0, -1)) {
            const next = lastMap.get(char) ?? {};
            lastMap.set(char, next);
            lastMap = next.next ??= new Map<string, TrieNode>();
        }
        const val = lastMap.get(key.slice(-1)) ?? {};
        val.value = map[key];
        lastMap.set(key.slice(-1), val);
    }

    // Add numeric values
    trie.set("#", numStart);

    return trie;
}

function markLegacyEntries(
    trie: Map<string, TrieNode>,
    legacy: Record<string, string>
) {
    for (const key of Object.keys(legacy)) {
        // Resolve the key
        let lastMap: TrieNode = { next: trie };
        for (const char of key) {
            const next = lastMap.next?.get(char);
            if (!next) throw new Error(`Could not find ${key} at ${char}`);
            lastMap = next;
        }
        lastMap.legacy = true;
    }

    return trie;
}
