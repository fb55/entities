# Named entity array-mapped radix tree generator

In `v3.0.0`, `entities` adopted a version of the radix tree from
[`parse5`](https://github.com/inikulin/parse5). The below is adapted from
@inikulin's explanation of this structure.

Prior to `parse5@3.0.0`, the library used simple pre-generated
[trie data structure](https://en.wikipedia.org/wiki/Trie) for
[named character references](https://html.spec.whatwg.org/multipage/syntax.html#named-character-references)
in the tokenizer. This approach suffered from huge constant memory consumption:
the in-memory size of the structure was ~8.5Mb. This new approach reduces the
size of the character reference data to ~250Kb, at equivalent performance.

## Radix tree

The trie was replaced with a
[radix tree](https://en.wikipedia.org/wiki/Radix_tree). Unlike a trie, which
contains only _nodes_, a radix tree contains _nodes_ and _edges_. If subsequent
nodes contain only one branch, they can be combined into a single edge.

E.g. for the words `test`, `tester` and `testing`, we'll receive the following
trie:

Legend: `[a, ...]` - node, `<abc>` - edge, `*` - data.

```
              [t]
               |
              [e]
               |
              [s]
               |
              [t]
               |
           [e, i, *]
           /   |
         [r]  [n]
          |    |
         [*]  [g]
               |
              [*]
```

With a radix tree, this is reduced to:

```
        <test>
          |
      [e, i, *]
      /   |
    <r>  <ng>
     |     |
    [*]   [*]
```

This approach has two advantages:

-   it significantly reduces the number of nodes, and thus memory allocated for
    the data strucure;
-   edges can be represented as a simple array.

## Mapping the radix tree to an array

We've significantly reduced the size of the tree. However, since we need to
allocate an object for each node and array for each edge, it still consumes a
lot of memory. Therefore, we map our tree to an array, so we'll end up with just
a single object. Since we don't have indices and code points which are more than
`MAX_UINT16` (which is `0xFFFF`), we can use a `Uint16Array` for this.

The only exception here are
[surrogate pairs](https://en.wikipedia.org/wiki/UTF-16#U.2B10000_to_U.2B10FFFF),
which appear in named character reference results. They can be split across two
`uint16` code points. The advantage of typed arrays is that they consume less
memory and are extremely fast to traverse.

Since edges are already arrays, we write them to the final array as is.

### Mapping nodes

#### Node header

Edges are represented as plain code points. To distinguish nodes from edges, we
need a marker, which will tell the traversing algorithm that it found a node.

Character reference names contain only ASCII characters. So, any value above 128
will be outside of this range. We therefore use the upper 8 bits to identify
nodes.

A node may contain one or two bytes of data and/or branch data. The layout of a
node is as follows:

```
1 bit |  7 bit  |  1 bit  |  7 bit
 \        \         \         \
  \        \         \         \
   \        \         \         jump table offset
    \        \         flag if the value uses two bytes (for surrugate pairs)
     \        number of branch data bytes
      node marker
```

The higher 8 bit are relevant for distinguishing nodes from edges, the lower
ones provide supplemental information.

#### Branch data

Branches can be represented in three different ways:

-   If we only have a single branch, and this branch wasn't encoded earlier in
    the tree, we set the branch number to 0 and the jump table offset to the
    branch data. The behavior of the branch is then identical to an edge.
-   If the branches edges are close to one another, we use a jump table. This is
    indicated by the jump table offset not being 0. The jump table is an array
    of destination indices. Index 0 is used for the value of the jump table
    offset.
-   If the branches edges are far apart, we use a dictionary. Branch data is
    represented by two arrays, following one after another. The first array
    contains sorted transition code points, the second one the corresponding
    next edge/node indices. The traversing algorithm will use a binary search to
    find the key, and will then use the corresponding value as the jump target.

The original `parse5` implementation only used the dictionary approach. Adding
the alternative approaches led to a size reduction of the tree.
