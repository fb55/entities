export type EncodeTrieNode =
    | string
    | { v?: string; n: number | Map<number, EncodeTrieNode>; o?: string };

function wrapNode(node: EncodeTrieNode): EncodeTrieNode {
    if (typeof node === "string") return `&${node};`;
    if (node.v) node.v = `&${node.v};`;
    // Inline branch with an 'o' value that needs wrapping.
    if (typeof node.n === "number" && node.o) node.o = `&${node.o};`;
    /*
     * Do not recurse into node.n when it is a Map; its entries are wrapped
     * by a separate call to restoreDiff within its own serialized expression.
     */
    return node;
}

export function restoreDiff<T extends ReadonlyArray<[number, EncodeTrieNode]>>(
    array: T,
): T {
    for (let index = 0; index < array.length; index++) {
        if (index !== 0) array[index][0] += array[index - 1][0] + 1;
        array[index][1] = wrapNode(array[index][1]);
    }
    return array;
}
