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

Nodes are stored in a single `Uint16Array`. Every node begins with one 16‑bit
header word. The current bit layout is:

```
15..14  value length field (see below; encoded length, not raw character count)
13      dual‑use flag:
                    - if valueLength > 0: semicolon-required flag (no explicit ';' branch stored)
                    - if valueLength == 0: compact run flag (see “Compact runs”)
12..7   branch length / span (meaning depends on encoding mode; see “Branch data”)
6..0    jump table offset OR first character (single branch / run) OR part of packed info
```

#### Value length encoding

Only up to two UTF-16 code units are ever stored out‑of‑line (HTML named
character reference values are at most two code points / surrogate halves here).
The 2‑bit value length field is an encoded length using a “+1” scheme:

- 0 – No value is present on this node.
- 1 – Single code unit value inlined in the lower 14 bits (bits 13..0). Bits 13
  and 12 are masked out during decode so the inline character must not have its
  13th bit set (the encoder rejects such code points for inlining).
- 2 – One code unit value stored in the next array element.
- 3 – Two code unit value stored in the next two array elements.

If the (raw) value is just one code unit and it cannot be safely inlined (e.g.
it would collide with flag bits, the node also has branches, or the code unit
needs more than 14 bits), the encoder stores it out‑of‑line, choosing encoded
length 2.

#### Semicolon handling

HTML has “strict” entities that require a trailing semicolon and “legacy” ones
for which it is optional. For strict entities we do not emit an explicit `';'`
child node; instead we set the semicolon-required flag (bit 13 with
`valueLength > 0`). During decode the unsuffixed key is replaced with only the
suffixed variant.

Legacy entities that allow the omission of the semicolon are represented as two
separate nodes: one without the semicolon and one reached via an explicit `';'`
branch. These never set the semicolon-required flag.

### Compact runs

When a node has no value (`valueLength == 0`) and there is a linear chain of at
least three single‑child nodes leading to a terminal (value) or branching node,
the encoder may collapse this path into a “compact run” to save space and
pointer chasing. This is indicated by bit 13 (run flag) being set while the
value length field is 0.

- Bits 12..7 store the run length (6 bits, 1–63). The run length counts the
  number of characters in the collapsed path.
- Bits 6..0 store the first character.
- The remaining (runLength - 1) characters are stored packed two per `uint16`
  word (low byte / high byte) immediately after the header. After the packed
  characters the final node (the child that owned a value or branches) is
  encoded in normal form.

If a potential run would end in a node whose value also appears via a legacy
semicolon branch, the encoder rejects the run to preserve semantics.

### Branch data

If a node has branch data (number of branches > 0 or jump table offset ≠ 0),
that branch data immediately follows the node header (or the packed path in the
case of a standard compact run).

Branches can be represented in three different ways:

1. Single branch inlined: If there is exactly one child and that child node has
   not been encoded elsewhere, the encoder sets the branch length bits to 0 and
   writes the child character code into bits 6..0. The child node header follows
   immediately. (If bits 6..0 are also 0 this would be ambiguous, so a single
   branch with char code 0 falls back to another form.)
2. Jump table: When branch keys form a relatively dense range, a jump table is
   used. Bits 6..0 store the offset (minimum key); bits 12..7 store the span
   length (maxKey - minKey + 1). A table of that many `uint16` slots follows.
   Each slot stores destinationIndex+1 (so 0 means “no branch”).
3. Dictionary (sparse): For sparse / far‑apart keys we store:
    - Packed key array: `(branchCount + 1) >> 1` words, each containing two
      8‑bit sorted keys (low byte even index, high byte odd index).
    - Destination array: `branchCount` words, each a raw destination index. The
      branch length bits store the number of branches; the offset (bits 6..0) is
      0 to distinguish from jump table form.

In both jump table and dictionary modes, recursive / duplicated subtrees are
deduplicated via node caching so repeated branches point to the same encoded
node index.

The original `parse5` implementation used a radix tree, with dictionary packing
and a variation of the single‑branch optimisation. The `entities` adaptation
adds semicolon handling, compact runs, inlining rules and a more compact header
bit layout while still decoding to the same logical mapping.
