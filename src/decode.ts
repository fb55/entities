import entityMap from "./maps/entities.json";
import legacyMap from "./maps/legacy.json";
import xmlMap from "./maps/xml.json";
import decodeCodePoint from "./decode_codepoint";

export interface TrieNode {
    value?: string;
    postfix?: string;
    offset?: number;
    legacy?: boolean;
    base?: number;
    next?: Map<number, TrieNode>;
}

enum CHAR_CODES {
    NUM = "#".charCodeAt(0),
    SEMI = ";".charCodeAt(0),
    LOWER_X = "x".charCodeAt(0),
    UPPER_X = "X".charCodeAt(0),
}

const numStart: TrieNode = (function () {
    type RecursiveMap = Map<number, TrieNode>;
    const numStart: RecursiveMap = new Map();

    const numRecurse: RecursiveMap = new Map();
    const numValue = { next: numRecurse, base: 10 };

    for (let i = 0; i <= 9; i++) {
        numStart.set(i.toString(10).charCodeAt(0), numValue);
        numRecurse.set(i.toString(10).charCodeAt(0), numValue);
    }

    const hexRecurse: RecursiveMap = new Map();
    const hexValue = { next: hexRecurse, base: 16 };
    for (let i = 0; i <= 15; i++) {
        hexRecurse.set(i.toString(16).charCodeAt(0), hexValue);
        hexRecurse.set(i.toString(16).toUpperCase().charCodeAt(0), hexValue);
    }

    const hexStart = { next: hexRecurse };
    numStart.set(CHAR_CODES.LOWER_X, hexStart);
    numStart.set(CHAR_CODES.UPPER_X, hexStart);

    return { next: numStart };
})();

function getTrieReplacer(trieStart: TrieNode, legacyEntities: boolean) {
    return (str: string) => {
        let ret = "";
        let lastIdx = 0;
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
                const c = str.charCodeAt(idx);
                if (c === CHAR_CODES.SEMI) {
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

                    if (!next) break;

                    if (next.postfix != null) {
                        if (
                            next.postfix !==
                            str.substr(idx + 1, next.postfix.length)
                        ) {
                            break;
                        }

                        idx += next.postfix.length;
                    }

                    trieNode = next;

                    if (legacyEntities && next.legacy) {
                        legacyTrie = next;
                    }
                }
            }

            if (legacyEntities) {
                if (legacyTrie) {
                    ret += legacyTrie.value;
                    lastIdx += legacyTrie.offset! + 2;
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
    const trie = new Map<number, TrieNode>();

    for (const key of Object.keys(map)) {
        // Resolve the key
        let lastMap = trie;
        for (let i = 0; i < key.length - 1; i++) {
            const char = key.charCodeAt(i);
            const next = lastMap.get(char) ?? {};
            lastMap.set(char, next);
            lastMap = next.next ??= new Map();
        }
        const val = lastMap.get(key.charCodeAt(key.length - 1)) ?? {};
        val.value = map[key];
        lastMap.set(key.charCodeAt(key.length - 1), val);
    }

    // Combine chains of nodes with a single branch to a postfix
    function addPostfixes(node: TrieNode, offset: number) {
        if (node.next) {
            node.next.forEach((next) => addPostfixes(next, offset + 1));

            if (node.value == null && node.next.size === 1) {
                node.next.forEach((next, char) => {
                    node.postfix =
                        String.fromCharCode(char) + (next.postfix ?? "");
                    node.value = next.value;
                    node.next = next.next;
                });
            }
        }

        if (node.value != null) {
            node.offset = offset + (node.postfix?.length ?? 0);
        }
    }

    trie.forEach((node) => addPostfixes(node, 0));

    // Add numeric values
    trie.set(CHAR_CODES.NUM, numStart);

    return trie;
}

function markLegacyEntries(
    trie: Map<number, TrieNode>,
    legacy: Record<string, string>
) {
    for (const key of Object.keys(legacy)) {
        // Resolve the key
        let lastMap: TrieNode = { next: trie };

        for (let i = 0; i < key.length; i++) {
            const char = key.charCodeAt(i);
            const next = lastMap.next?.get(char);
            if (!next) throw new Error(`Could not find ${key} at ${char}`);
            lastMap = next;

            // We know we have found a part of the entity, so skip the length of the postfix
            if (next.postfix) i += next.postfix.length;
        }
        lastMap.legacy = true;
    }

    return trie;
}
