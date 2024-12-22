export interface TrieNode {
    value?: string;
    next?: Map<number, TrieNode> | undefined;
}

export function getTrie(
    map: Record<string, string>,
    legacy: Record<string, string>,
): TrieNode {
    const trie = new Map<number, TrieNode>();
    const root = { next: trie };

    for (const key of Object.keys(map)) {
        // Resolve the key
        let lastMap = trie;
        let next!: TrieNode;
        for (let index = 0; index < key.length; index++) {
            const char = key.charCodeAt(index);
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

        for (const [char, node] of node1.next) {
            const value = node2.next.get(char);
            if (value == null || !isEqual(node, value)) {
                return false;
            }
        }

        return true;
    }

    function mergeDuplicates(node: TrieNode) {
        const nodes = [node];

        for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
            const { next } = nodes[nodeIndex];

            if (!next) continue;

            for (const [char, node] of next) {
                const index = nodes.findIndex((n) => isEqual(n, node));

                if (index === -1) {
                    nodes.push(node);
                } else {
                    next.set(char, nodes[index]);
                }
            }
        }
    }

    mergeDuplicates(root);

    return root;
}
