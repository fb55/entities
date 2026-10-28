# The decode data format

Decoding turns `&amp;`-style character references back into text. Until v9
this library walked a binary trie packed into a `Uint16Array`; it now uses a
hash table over the full entity names. The shipped data is a pair of strings
for the HTML entity set, from which all lookup structures are built at module
initialization. XML's five predefined entities are matched directly in
`src/decode.ts` and ship no data.

Constants and helpers shared by the generator (`scripts/write-decode-map.ts`)
and the runtime (`src/decode.ts`) live in
[`src/internal/decode-data-format.ts`](../src/internal/decode-data-format.ts).

## How one lookup works

Decoding a short name such as `&uuml;` (→ `ü`) takes three steps:

1. **Class table → candidate lengths.** The two characters after the `&` are
   hashed by `pairIndex` into a 1024-entry array, `lengthBits`. Its word lists
   the candidate name lengths for that class, the legacy lengths, and a flag
   for names longer than 16 characters. A zero word rejects the input
   immediately; hash collisions may add candidates that step 2 rejects.

2. **Probe + key table → slot.** For each candidate length L, shortest first,
   the decoder checks whether `input[start + L]` is `;`. Only on a hit does it
   build the exact 32-bit key and look it up in the cuckoo table: two
   buckets, two slots each, at most four comparisons. A key match proves four
   characters and the length, so only the middle characters are compared.

3. **Slot → replacement.** The slot points into the `values` string, and that
   slice (`ü`) is emitted.

**Legacy entities** (semicolon-optional, like `&copy`) are marked in step 1.
A failed `;` probe at a legacy length is itself the legacy signal: the
decoder looks the name up right there and keeps the candidate, emitting it
only after the loop, since a `;`-terminated match at any length wins.
Ascending probe order makes the last candidate the longest legacy match.

## Why not a trie?

A trie walk is a serial dependency chain: every input character costs a
dependent memory load and node dispatch before the next one can be read. The
hash table resolves a candidate with O(1) dependent loads regardless of name
length.

## Shipped form

Entity names are sorted case-sensitively and
[front-coded](https://en.wikipedia.org/wiki/Incremental_encoding): each name
stores only the length of the prefix it shares with its predecessor plus the
differing suffix. Case twins like `Auml`/`auml` front-code against each other.

The shipped value is `[data, values]`:

- `data` = header (6 chars) + suffixes + meta (2 chars per name) + choices.
  All chars stay at or below U+00FF (the generator asserts this), so V8 keeps
  the string one-byte.
- `values` = the concatenated replacement strings, kept separate so they
  don't force `data` into a two-byte representation. The generator escapes
  characters above U+00FF in the source.

| section | encoding |
| --- | --- |
| header | bias 0x30: name count (2 chars, hi/lo 6 bits), suffixes length (2), cuckoo bucket count (2) |
| meta | bias 0x23, two chars per name: `prefixLen \| legacy << 5`, `suffixLen \| (valueLen - 1) << 5` |
| choices | one bit per name, six per char, bias 0x30 |

## Keys and the cuckoo table

Every name maps to an exact 32-bit key:

```
c0:7 | c1:7 | c[len-2]:7 | remap6(c[len-1]):6 | len:5
```

The last character is compressed to 6 bits via an alphanumeric remap.
Different names may share a key (`LongRightArrow`/`Longrightarrow`), so
lookups verify the middle characters (positions 2..len-3) per candidate;
names of length ≤ 4 need no verification. Characters ≥ 0x80 would alias
inside the 7-bit fields and are rejected before the key is formed.

Middles share a deduplicated `Uint32Array`, two UTF-16 code units per word.
Comparing full 16-bit units keeps non-ASCII lookalikes from matching.

The current data uses 4,096 buckets of two slots. Each key has two candidate
buckets from two multiplicative hashes; the generator picks one per name
(using augmenting paths, which find a placement whenever one exists) and
ships that bit in `choices`. This is
[cuckoo hashing](https://en.wikipedia.org/wiki/Cuckoo_hashing) with bucket
size 2: a lookup does at most four key comparisons across two cache lines,
and both bucket computations are independent arithmetic. A
displacement-based perfect hash (CHD) has a smaller table but puts an extra
dependent load on the critical path, and measured slower.

## Long names and streaming

Classes with names longer than 16 characters take a separate path: the
decoder searches a window of at most 32 characters for `;` and verifies that
candidate directly, falling back to the longest legacy match. The bounded
window keeps repeated invalid references from scanning quadratically.

Across chunk boundaries, HTML buffers up to 32 alphanumeric characters in a
reusable `Uint8Array` and verifies them against the same tables; a 32nd
character rules out every exact match. XML's partial names (at most four
lowercase letters) fit in a 28-bit integer.

## Replacement values

`slotValue` (a `Uint16Array`) packs each slot's offset into `values` (bits
2..15), a legacy flag (bit 1), and the value length minus one (bit 0). Values
are at most two UTF-16 code units; the streaming decoder emits each unit
separately.

## Engineering notes (V8, measured on this code)

- Keep decoder sources within Latin-1, including comments: one wider
  character makes V8 retain the whole source as a two-byte string.
- Use scalar constants rather than `const enum`s: with `isolatedModules`,
  TypeScript emits runtime objects for them.
- The HTML decoder is specialized over module-level constants. Per-dataset
  factory closures were 25–50% slower.
- Single-character `indexOf` (a vectorized memchr) is the fastest way to find
  `&`; regex scanners measured 1.5–3.5× slower.
- Small dedicated lookup tables stay L1-resident; folding their bits into
  larger arrays measured up to 35% slower.
- The probe loops are sensitive to function body size; keep cold work
  (legacy resolution, long-name scans) out of the hot path.
- Keep string and typed-array reads in bounds, including at EOF:
  out-of-bounds reads return `NaN`/`undefined` and can deoptimize later
  calls. Benchmarks should warm incomplete names and numeric references too.
- Exact and legacy matches share lookup and emission call sites; separate
  sites can trigger reoptimization that slows ordinary inputs.
