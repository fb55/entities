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
    const numValue = { next: numRecurse };

    for (let i = 0; i <= 9; i++) {
        numStart.set(i.toString(10), numValue);
        numRecurse.set(i.toString(10), numValue);
    }

    const hexRecurse: RecursiveMap = new Map();
    const hexValue = { next: hexRecurse };
    for (let i = 0; i <= 15; i++) {
        hexRecurse.set(i.toString(16), hexValue);
        hexRecurse.set(i.toString(16).toUpperCase(), hexValue);
    }

    numStart.set("x", hexValue);
    numStart.set("X", hexValue);

    return { next: numStart };
})();

function getTrieReplacer(trie: Map<string, TrieNode>, legacyEntities: boolean) {
    const trieStart = { next: trie };
    return (str: string) => {
        let ret = "";
        let lastIdx = 0;
        let idx = 0;
        while ((idx = str.indexOf("&", idx)) >= 0) {
            const start = idx;
            let trieNode: TrieNode | undefined = trieStart;
            let legacyMap: TrieNode | undefined;
            let legacyIndex = 0;
            while (
                ++idx < str.length &&
                trieNode?.next &&
                str.charAt(idx) !== ";"
            ) {
                trieNode = trieNode.next.get(str.charAt(idx));
                if (legacyEntities && trieNode?.legacy) {
                    legacyMap = trieNode;
                    legacyIndex = idx;
                }
            }

            const isTerminated = idx < str.length && str.charAt(idx) === ";";

            if (
                (legacyEntities || isTerminated) &&
                str.charAt(start + 1) === "#"
            ) {
                const secondChar = str.charAt(start + 2);
                const codePoint =
                    secondChar === "x" || secondChar === "X"
                        ? parseInt(str.substring(start + 3, idx), 16)
                        : parseInt(str.substring(start + 2, idx), 10);
                ret +=
                    str.substring(lastIdx, start) + decodeCodePoint(codePoint);
                lastIdx = idx += Number(isTerminated);
            } else if (isTerminated) {
                if (trieNode?.value) {
                    ret += str.substring(lastIdx, start) + trieNode.value;
                    lastIdx = idx += 1;
                }
            } else if (legacyMap) {
                ret += str.substring(lastIdx, start) + legacyMap.value;
                lastIdx = idx = legacyIndex + 1;
            }
        }

        return ret + str.substr(lastIdx);
    };
}

export const xmlTrie = getTrie(xmlMap);
export const decodeXML = getTrieReplacer(xmlTrie, false);
export const htmlTrie = markLegacyEntries(getTrie(entityMap), legacyMap);
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
