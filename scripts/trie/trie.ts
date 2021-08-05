import { CharCodes } from "../../src/decode";

export interface TrieNode {
    value?: string;
    postfix?: string;
    offset?: number;
    legacy?: boolean;
    base?: number;
    next?: Map<number, TrieNode>;
}

const numStart: TrieNode = (function () {
    type RecursiveMap = Map<number, TrieNode>;
    const numStart: RecursiveMap = new Map();

    const numRecurse: RecursiveMap = new Map();
    const numValue = { next: numRecurse, base: 10, legacy: true };

    for (let i = 0; i <= 9; i++) {
        numStart.set(i.toString(10).charCodeAt(0), numValue);
        numRecurse.set(i.toString(10).charCodeAt(0), numValue);
    }

    numRecurse.set(CharCodes.SEMI, { base: 10 });

    const hexRecurse: RecursiveMap = new Map();
    const hexValue = { next: hexRecurse, base: 16, legacy: true };
    for (let i = 0; i <= 15; i++) {
        hexRecurse.set(i.toString(16).charCodeAt(0), hexValue);
        hexRecurse.set(i.toString(16).toUpperCase().charCodeAt(0), hexValue);
    }

    hexRecurse.set(CharCodes.SEMI, { base: 16 });

    const hexStart = { next: hexRecurse };
    numStart.set(CharCodes.LOWER_X, hexStart);
    numStart.set(CharCodes.UPPER_X, hexStart);

    return { next: numStart };
})();

export function getTrie(
    map: Record<string, string>,
    legacy: Record<string, string>
): TrieNode {
    const trie = new Map<number, TrieNode>();

    for (const key of Object.keys(map)) {
        // Resolve the key
        let lastMap = trie;
        let next!: TrieNode;
        for (let i = 0; i < key.length; i++) {
            const char = key.charCodeAt(i);
            next = lastMap.get(char) ?? {};
            lastMap.set(char, next);
            lastMap = next.next ??= new Map();
        }

        if (key in legacy) {
            next.value = map[key];
            next.legacy = true;
        }

        lastMap.set(CharCodes.SEMI, { value: map[key] });
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
                    node.legacy = next.legacy;
                });
            }
        }

        if (node.value != null) {
            node.offset = offset + (node.postfix?.length ?? 0);
        }
    }

    trie.forEach((node) => addPostfixes(node, 0));

    // Add numeric values
    trie.set(CharCodes.NUM, numStart);

    return { next: trie };
}
