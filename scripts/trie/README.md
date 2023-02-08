# Named entity array-mapped trie generator

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

All entities are encoded as a trie, which contains _nodes_. Nodes contain data
and branches.

E.g. for the words `test`, `tester` and `testing`, we'll receive the following
trie:

Legend: `[a, ...]` - node, `*` - data.

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

## Mapping the trie to an array

If we had to allocate an object for each node, the trie would consume a lot of
memory (the aforementioned ~8.5Mb). Therefore, we map our trie to an array, so
we'll end up with just a single object. Since we don't have indices and code
points which are more than `MAX_UINT16` (which is `0xFFFF`), we can use a
`Uint16Array` for this.

The only exception here are
[surrogate pairs](https://en.wikipedia.org/wiki/UTF-16#U.2B10000_to_U.2B10FFFF),
which appear in named character reference results. They can be split across two
`uint16` code points. The advantage of typed arrays is that they consume less
memory and are extremely fast to traverse.

### Node layout

A node may contain one or two bytes of data and/or branch data. The layout of a
node is as follows:

```
2 bit |  7 bit  |  7 bit
 \        \         \
  \        \         \
   \        \         \
    \        \         jump table offset
     \        number of branches
      value length
```

The _value length_ is the number of bytes used for the value. If the length is
0, we don't have a value. If the length is 1, the node does not have any
branches and the value will be stored inside the lower 14 bit of the node
itself. Otherwise, the value will be stored in the next one or two bytes of the
array.

If it has any branch data (indicated by the _number of branches_ or the _jump
table offset_ being set), the node will be followed by the branch data.

### Branch data

Branches can be represented in three different ways:

1.  If we only have a single branch, and this branch wasn't encoded earlier in
    the tree, we set the number of branches to 0 and the jump table offset to
    the branch value. The node will be followed by the serialized branch.
2.  If the branch values are close to one another, we use a jump table. This is
    indicated by the jump table offset not being 0. The jump table is an array
    of destination indices.
3.  If the branch values are far apart, we use a dictionary. Branch data is
    represented by two arrays, following one after another. The first array
    contains sorted transition code points, the second one the corresponding
    next edge/node indices. The traversing algorithm will use binary search to
    find the key, and will then use the corresponding value as the jump target.

The original `parse5` implementation used a radix tree as the basis for the
encoded structure. It used a dictionary (see (3) above), as well as a variation
of (1) for edges of the radix tree. The implementation in `entities` allowed us
to use a trie when starting to decode, and gave us some space savings in the
output.
