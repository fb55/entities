export interface TrieNode {
    value?: string;
    next?: Map<number, TrieNode> | undefined;
}

export function getTrie(
    map: Record<string, string>,
    legacy: Record<string, string>
): TrieNode {
    const trie = new Map<number, TrieNode>();
    const root = { next: trie };

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

    function isEqual(node1: TrieNode, node2: TrieNode): boolean {
        if (node1 === node2) return true;

        if (node1.value !== node2.value) {
            return false;
        }

        // Check if the next nodes are equal. That means both are undefined.
        if (node1.next === node2.next) return true;
        if (
            node1.next == null ||
            node2.next == null ||
            node1.next.size !== node2.next.size
        ) {
            return false;
        }

        const next1 = Array.from(node1.next);
        const next2 = Array.from(node2.next);

        return next1.every(([char1, node1], idx) => {
            const [char2, node2] = next2[idx];
            return char1 === char2 && isEqual(node1, node2);
        });
    }

    function mergeDuplicates(node: TrieNode) {
        const nodes = [node];

        for (let nodeIdx = 0; nodeIdx < nodes.length; nodeIdx++) {
            const { next } = nodes[nodeIdx];

            if (!next) continue;

            for (const [char, node] of Array.from(next)) {
                const idx = nodes.findIndex((n) => isEqual(n, node));

                if (idx >= 0) {
                    next.set(char, nodes[idx]);
                } else {
                    nodes.push(node);
                }
            }
        }
    }

    mergeDuplicates(root);

    return root;
}
