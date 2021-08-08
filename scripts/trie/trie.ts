import { CharCodes } from "../../src/decode";

export interface TrieNode {
    value?: string;
    postfix?: string;
    offset?: number;
    next?: Map<number, TrieNode>;
}

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

        if (key in legacy) next.value = map[key];

        lastMap.set(";".charCodeAt(0), { value: map[key] });
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

    return { next: trie };
}
