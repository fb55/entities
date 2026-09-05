# Named entity trie generator

The generator stores entity names and their decoded values in a flat
`Uint16Array`. Shared subtrees, compact character runs, and inline values keep
this representation small. The HTML array is serialized with a dictionary
encoding; the XML array is emitted directly.

## Generation and decoding

- [trie.ts](trie.ts) builds the name trie and merges identical subtrees.
- [encode-trie.ts](encode-trie.ts) writes the binary node format described below.
- [encode-dict.ts](encode-dict.ts) serializes the HTML array using base-91 slot codes and
  byte-pair encoding (BPE).
- [write-decode-map.ts](../write-decode-map.ts) writes both generated modules
  in [src/generated](../../src/generated).
- [decode-shared.ts](../../src/internal/decode-shared.ts) expands the HTML
  dictionary at import time.
- [decode.ts](../../src/decode.ts) traverses the array for HTML decoding and
  streaming decoding.
  The synchronous XML decoder matches the five XML names directly.

Run `npm run build:trie` to regenerate the modules. Tests check the generated
maps, runtime decoders, and dictionary round trips.

## Node layout

Each node starts with a 16-bit header. Values use UTF-16 code units, so an
astral code point occupies two value words. Entity values occupy at most two
code units.

| Bits | Meaning |
| --- | --- |
| 15..14 | Encoded value length |
| 13 | Semicolon required on a value node; compact run on a node without a value |
| 12..7 | Branch count, jump-table span, or compact-run length |
| 6..0 | Jump-table offset, single-branch character, or first run character |

An inline value uses bits 12..0 in place of branch metadata. The masks are
also defined in [bin-trie-flags.ts](../../src/internal/bin-trie-flags.ts).

### Values and semicolons

The encoded value length selects one of four layouts:

- `0`: No value. Branch data or a compact run follows the header.
- `1`: One code unit, at most `0x1fff`, stored in bits 12..0 of the header.
  This node has no branches.
- `2`: One code unit stored in the next word.
- `3`: Two code units stored in the next two words.

Single code units that exceed the inline mask, or whose nodes have branches,
use encoded length `2`. Bit 12 belongs to the inline value; bit 13 is reserved
for the semicolon flag.

All names store their value on the terminal node, with no explicit `;` child.
Bit 13 is set for names that require a semicolon and clear for legacy names
that permit its omission. Both accept a following semicolon. Strict decoding
requires it for every name; attribute decoding additionally checks the
character following an unterminated legacy match.

### Compact runs

A node without a value can collapse a chain of 3–63 single-child edges into a
compact run. The target must have a value or multiple branches and must not
already be encoded, because it follows the run directly.

- Bit 13 marks the run; bits 12..7 store its character count.
- Bits 6..0 store its first character.
- The remaining characters are packed two per word, low byte first.
- The target node starts after the header and `runLength >> 1` packed words.

The streaming decoder retains the number of matched run characters across
writes. Runs longer than 63 characters fall back to normal branch encoding.

### Branch data

Branch data follows the header and any out-of-line value words. Entity names
use ASCII character keys. There are three branch layouts:

1. **Single branch:** For an uncached child, bits 6..0 store its character
   and bits 12..7 are zero. The child follows directly.
2. **Jump table:** Bits 6..0 store the first covered character, and bits
   12..7 store the span (`maxKey - minKey + 1`, at most 63). One word per
   covered character follows. A zero slot means no branch; other slots store
   the child's offset from the end of the table, plus one.
3. **Dictionary:** Bits 6..0 are zero, and bits 12..7 store the branch count.
   Sorted keys occupy `ceil(branchCount / 2)` words, packed low byte first.
   Then `branchCount` words store child offsets from the end of the branch
   data, with no added sentinel offset. The decoder scans the sorted keys.

The generator allows a jump table when its span is at most four times its
branch count. This budget applies uniformly to both maps. The HTML root must
be a jump table with multiple branches, no value, and no compact run; the
synchronous decoder relies on that shape, and the generator asserts it.

Children are encoded in increasing estimated subtree size, while pointers
occupy key-ordered slots. This keeps forward offsets small. Shared children
reuse their encoded node index. Backward offsets wrap modulo 65536, and
readers mask reconstructed indices with `& 0xffff`. The encoder limits the
array to 65536 words so every node index is representable.

## Dictionary serialization

Distinct array values are atoms. BPE merges frequent token pairs into ngrams,
with each ngram referencing two atoms or ngrams available at decode time.
Frequent atoms and promoted ngrams receive one-character codes; other tokens
receive two-character codes. Atom values are sorted within each dictionary
and serialized using deltas and run-length encoding.

The serialized streams contain, in order:

1. One-character-code atoms.
2. Two-character-code atoms.
3. Two-character-code ngrams.
4. One-character-code ngrams.
5. The trie data as slot codes.

Ngram references must point to entries filled by preceding streams or earlier
entries within their stream. The runtime decoder expands them into a shared
pool before writing the trie array.

The encoder searches one-character dictionary sizes from 45 through 75 and
selects the shortest serialized string. BPE is capped at 25 merges to limit
dictionary size and retain repeated patterns for transport compression. The
base-91 alphabet is printable ASCII excluding `"`, `$`, and `\`.
