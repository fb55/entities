/**
 * Trie node used for entity encoding and decoding.
 */
export interface TrieNode {
    value?: string;
    next?: Map<number, TrieNode> | undefined;
    /** If true, the value requires a semicolon terminator (implicit ';' not stored as separate branch). */
    semiRequired?: boolean;
}

/**
 * Build a trie from canonical and legacy entity maps.
 * @param map Map used to construct trie nodes.
 * @param legacy Whether legacy HTML entities should be included.
 */
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
            // Always set the node for this character.
            lastMap.set(char, next);
            /*
             * Only create / advance into a child map if this is NOT the terminal character.
             * This prevents creation of empty next maps, enabling tighter encoding for leaf nodes
             * (eg allowing single-char values to be stored inline and avoiding ambiguous empty maps).
             */
            if (index < key.length - 1) {
                lastMap = next.next ??= new Map();
            }
        }

        const value = map[key];
        const isLegacy = key in legacy;

        /*
         * All entities store the value on the terminal node.
         * Strict entities require a semicolon (FLAG13 set); legacy entities
         * accept an optional semicolon (FLAG13 clear), handled implicitly by
         * the decoder — no explicit ';' child needed.
         */
        next.value = value;
        if (!isLegacy) {
            next.semiRequired = true;
        }
    }

    function isEqual(node1: TrieNode, node2: TrieNode): boolean {
        if (node1 === node2) return true;

        if (node1.value !== node2.value) {
            return false;
        }

        // Distinguish nodes that differ in semicolon requirement; this affects encoding semantics.
        if (node1.semiRequired !== node2.semiRequired) {
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
