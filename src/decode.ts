import entityMap from "./maps/entities.json";
import legacyMap from "./maps/legacy.json";
import xmlMap from "./maps/xml.json";
import decodeCodePoint from "./decode_codepoint";

export interface TrieNode {
    value?: string;
    legacy?: boolean;
    base?: number;
    next?: Map<string, TrieNode>;
}

const numStart: TrieNode = (function () {
    type RecursiveMap = Map<string, TrieNode>;
    const numStart: RecursiveMap = new Map();

    const numRecurse: RecursiveMap = new Map();
    const numValue = { next: numRecurse, base: 10 };

    for (let i = 0; i <= 9; i++) {
        numStart.set(i.toString(10), numValue);
        numRecurse.set(i.toString(10), numValue);
    }

    const hexRecurse: RecursiveMap = new Map();
    const hexValue = { next: hexRecurse, base: 16 };
    for (let i = 0; i <= 15; i++) {
        hexRecurse.set(i.toString(16), hexValue);
        hexRecurse.set(i.toString(16).toUpperCase(), hexValue);
    }

    const hexStart = { next: hexRecurse };
    numStart.set("x", hexStart);
    numStart.set("X", hexStart);

    return { next: numStart };
})();

function getTrieReplacer(trieStart: TrieNode, legacyEntities: boolean) {
    return (str: string) => {
        let ret = "";
        let lastIdx = 0;
        let legacyTrieIndex = 0;
        let idx = 0;

        function decodeNumeric(base: number) {
            const entity = str.substring(
                // Skip the leading "&#". For hex entities, also skip the leading "x".
                lastIdx + 2 + (base >>> 4),
                idx
            );
            const parsed = parseInt(entity, base);
            return decodeCodePoint(parsed);
        }

        entityLoop: while ((idx = str.indexOf("&", idx)) >= 0) {
            ret += str.slice(lastIdx, idx);
            lastIdx = idx;
            let trieNode: TrieNode = trieStart;
            let legacyTrie: TrieNode | undefined;

            while (++idx < str.length) {
                const c = str.charAt(idx);
                if (c === ";") {
                    if (trieNode.value) {
                        ret += trieNode.value;
                    } else if (trieNode.base) {
                        ret += decodeNumeric(trieNode.base);
                    } else break;

                    idx += 1;
                    lastIdx = idx;
                    continue entityLoop;
                } else {
                    const next = trieNode.next?.get(c);
                    if (next) {
                        trieNode = next;

                        if (legacyEntities && next.legacy) {
                            legacyTrie = next;
                            legacyTrieIndex = idx;
                        }
                    } else break;
                }
            }

            if (legacyEntities) {
                if (legacyTrie) {
                    ret += legacyTrie.value;
                    lastIdx = legacyTrieIndex + 1;
                } else if (trieNode.base) {
                    ret += decodeNumeric(trieNode.base);
                    lastIdx = idx;
                }
            }
        }

        return ret + str.substr(lastIdx);
    };
}

export const xmlTrie: TrieNode = { next: getTrie(xmlMap) };
export const decodeXML = getTrieReplacer(xmlTrie, false);
export const htmlTrie: TrieNode = {
    next: markLegacyEntries(getTrie(entityMap), legacyMap),
};
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
