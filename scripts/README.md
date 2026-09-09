# The decode data format

Decoding turns `&amp;`-style character references back into text. Until v9
this library walked a binary trie packed into a `Uint16Array`; it now uses a
flat hash table over the full entity names. The shipped data is a pair of
strings for the HTML entity set; all lookup structures are rebuilt from them
at module initialization. XML's five predefined entities
are matched directly in `src/decode.ts` and ship no data at all.

The constants and helper functions shared between the generator
(`scripts/write-decode-map.ts`) and the runtime (`src/decode.ts`) live in
[`src/internal/decode-data-format.ts`](../src/internal/decode-data-format.ts).

## How one lookup works

Decoding a short name such as `&uuml;` (→ `ü`) passes through three
structures in turn. Long-name classes use the alternative described below.

1. **Class table → candidate _lengths_.** The two characters after the `&`
   (`u`, `u`) are hashed by `pairIndex` into a 1024-entry array, `lengthBits`,
   requiring a single table read with no probing. The word found there lists
   candidate name _lengths_ for all prefixes sharing that class, plus a flag
   for names longer than 16 and a second bitset of legacy lengths. A zero
   word rejects the input without reading any further; hash collisions may
   add candidates that the next step rejects.

2. **Probe + key table → the matching _slot_.** For each candidate length L,
   shortest first, the decoder checks a single character: is `input[start +
   L]` a `;`? For `uuml`, L = 4 and `input[start + 4]` is `;` — a hit. *Only
   then* does it build the exact 32-bit key (first two characters, last two
   characters, length) and look that up in the cuckoo table `keys`: two
   candidate buckets, two slots each, at most four comparisons. The key is
   exact, not a lossy hash, so a key match already proves four characters and
   the length; only the middle characters (positions 2..L-3) are compared,
   and names of length ≤ 4 skip even that. The result is a *slot* index.

3. **Slot → replacement.** The slot indexes `slotValue`, a packed
   `(offset, length)` into the `values` string; that slice (`ü`) is emitted.

So the two “lookups” are distinct: step 1 is a direct-indexed table yielding
candidate *lengths*; step 2 is the hash table yielding the one matching
entity; step 3 is the value. It is a two-choice cuckoo table, **not a perfect
hash** — different names are even allowed to collide on a key, since the
middle-character check in step 2 disambiguates them.

**Legacy entities** (semicolon-optional, like `&copy`) ride along in step 1:
the class word marks which lengths may match without a `;`. When the `;`
probe at such a length *fails*, that failure is itself the legacy signal, so
the decoder runs the step-2 key lookup right there and stashes the candidate
in a local — emitting it only after the loop, because a longer
`;`-terminated match at any length would win.

## Why not a trie?

A trie walk is a serial dependency chain: every input character costs a
dependent memory load plus node-shape dispatch before the next character can
be looked at. Profiling showed the lookup itself was a small share of decode
time, but the walk forced the decoder to touch every character of every
candidate one at a time. The structures below resolve a candidate with O(1)
dependent loads regardless of name length.

## Shipped form: front-coded names

Entity names are sorted and *front-coded*: each name stores only the length
of the prefix it shares with its predecessor plus the differing suffix
(`Aacute`, `aacute`, `Abreve` → `Aacute`, `(1, "breve")`, …). Sorted front
coding is a classic dictionary-compression technique ([incremental
encoding](https://en.wikipedia.org/wiki/Incremental_encoding)); see also
Witten, Moffat & Bell, *Managing Gigabytes*, 2nd ed., Morgan Kaufmann, 1999
(the lexicon-compression discussion). Case-sensitive sort order measurably
beats all alternatives here because HTML's case-twin names (`Auml`/`auml`)
front-code against each other.

The shipped value is `[data, values]`:

- `data` = `header (6 chars) + suffixes + meta (2 chars per name) +
  choices`. All chars stay at or below U+00FF (the generator asserts this),
  so V8 keeps the string in one-byte representation. Header and meta chars
  can exceed U+007F — the current header contains U+00A8 — so the string is
  latin-1, not ASCII.
- `values` = the concatenated replacement strings (may contain any character;
  kept separate so it does not force the main string into two-byte
  representation).

| section | encoding |
| --- | --- |
| header | bias 0x30: name count (2 chars, hi/lo 6 bits), suffixes length (2), cuckoo bucket count (2) |
| meta | bias 0x23, two chars per name: `prefixLen \| legacy << 5`, `suffixLen \| (valueLen - 1) << 5` — the bias keeps every char printable, so none needs JSON escaping |
| choices | one bit per name, six per char, bias 0x30 — see below |

## Lookup: exact 32-bit keys in a two-choice (cuckoo) table

Every name maps to an *exact* key packing five fields:

```
c0:7 | c1:7 | c[len-2]:7 | remap6(c[len-1]):6 | len:5
```

(32 bits, with the last character compressed to 6 bits via an alphanumeric
remap table). Because the key is exact — not a lossy hash — a key match
proves four characters and the length; only middle characters (positions
2..len-3) need comparing, and names of length ≤ 4 need no verification at
all. Different names may share a key (`LongRightArrow`/`Longrightarrow`);
lookups simply verify middles per candidate. Inputs are not pre-filtered to
alphanumerics, so characters ≥ 0x80 — which would alias mod 128 inside the
7-bit fields — are rejected before the key is formed.

All middles share a deduplicated `Uint32Array`, with two UTF-16 code units
packed into each word and each middle starting on a word boundary. Lookup
compares pairs of input code units, then checks an odd trailing character
separately. Keeping all 16 bits of each input character prevents non-ASCII
lookalikes from matching. The pool occupies 9,896 bytes; it replaces a
3,505-character Latin-1 string and a 1,244-byte long-name pool, trading about
5.1 kB of runtime storage for fewer comparisons and one shared matcher.

The current data uses 4,096 two-slot buckets. This costs 45,743 more bytes
of key, slot-metadata and legacy-flag arrays than the earlier 1,281-bucket
layout, while reducing second-bucket placements from 784 to 124. It also
puts more common names in the first slot checked. Doubling to 8,192 buckets
did not provide a consistent further throughput gain in the measured
size/density workloads.

Keys live in a table of `B` buckets × 2 slots. Each key has two candidate
buckets derived from two multiplicative hashes; build time decides which one
each name uses and ships that single bit (the "choices" section). This is
[cuckoo hashing](https://en.wikipedia.org/wiki/Cuckoo_hashing) (Pagh &
Rodler, "Cuckoo Hashing", *Journal of Algorithms* 51(2), 2004) with bucket
size 2, which supports high load factors (Dietzfelbinger & Weidling,
"Balanced allocation and dictionaries with tightly packed constant size
bins", *Theoretical Computer Science* 380(1–2), 2007); the underlying
load-balancing phenomenon is the "power of two choices" (Azar, Broder,
Karlin & Upfal, "Balanced Allocations", *SIAM Journal on Computing* 29(1),
1999). The placement is found with augmenting paths (Berge, "Two Theorems in
Graph Theory", *PNAS* 43, 1957), which provably finds an assignment whenever
one exists.

A lookup therefore does at most 4 key comparisons across 2 cache lines — no
probe chains — and the two bucket computations are independent ALU, unlike
displacement-based perfect hashing (cf. Belazzougui, Botelho &
Dietzfelbinger, "Hash, Displace, and Compress", *ESA* 2009), whose extra
displacement load sits on the critical path. That serial load is why a
measured CHD variant lost to this design despite its smaller table.

## The probe front end

For each `&`, the first two characters select a 10-bit class whose packed
word lists possible short-name lengths, legacy lengths, and a long-name
flag. For classes containing only short names, the decoder probes
`input[start + len] === ';'` for each candidate, shortest first. A probe hit
triggers the table lookup, which verifies the entire span. Classes with no
candidates reject a junk run without reading it.

Classes containing names longer than 16 characters take a separate path in
synchronous decoding, and in streaming when 32 characters are available.
The decoder searches a window of at most 32 characters for `;`, then
verifies that candidate directly. This avoids both the shorter
length probes and a character-by-character scan before verification. A failed
exact lookup falls back to the longest permitted legacy match. Bounding the
window keeps repeated invalid references from causing quadratic scanning.

Across chunk boundaries, HTML uses a reusable 32-character `Uint16Array` and
verifies it directly against the same key and middle tables. This avoids
building and then reading a concatenated name string. A 32nd name character
rules out every exact match, while legacy matching still checks the buffered
prefix. Resetting the buffered length lets subsequent entities reuse the
64-byte storage without clearing it. XML's five names need at most four
lowercase ASCII letters, so its partial name fits in a 28-bit integer.

In the short-name path, legacy names need no terminator: a failed `;` probe at a
legacy-marked length *is* the legacy condition, so the loop performs the
lookup right there and records the candidate in a local. It is only emitted
after the loop, because HTML matches references greedily and a terminated
exact match at any length beats it (the two can never overlap: the `;` an
exact match needs would fail a longer legacy candidate's character
comparison). Ascending probe order makes the last recorded candidate the
longest legacy match. The names come from the [WHATWG HTML standard's named
character references
table](https://html.spec.whatwg.org/multipage/named-characters.html), and
the semicolon-optional subset is the spec's historical list.

## Replacement values

Each slot holds a `(offset << 2) | (length - 1)` reference (`slotValue`, a
`Uint16Array`) into the shipped `values` string, from which the emit either
takes a `charAt` (one-unit values, the vast majority) or a two-unit
`slice`. This replaces an earlier per-slot `string[]` design: half the
footprint and no ~1.4k value-string heap objects, for a slightly costlier
emit. Values are at most two UTF-16 code units (the generator asserts this;
the streaming decoder emits each unit as its own callback).

## Engineering notes (V8, all measured on this code)

- The synchronous HTML decoder is specialized over module-level constants.
  Per-dataset factory closures are 25–50% slower: N closure instances share
  one `SharedFunctionInfo`, which blocks function-context specialization;
  property loads off a `data` parameter cost ~20%.
- Single-character `indexOf` is backed by a vectorized memchr and is
  unbeatable for finding `&`: regex-based scanners measured 1.5–3.5x slower,
  and character-by-character lookahead loses too.
- Small dedicated lookup tables (the legacy bit-set, the class table) beat
  "fewer, larger arrays": they stay L1-resident. Folding bits into larger
  arrays measured up to +35% on the paths that use them.
- The probe loops are extremely sensitive to function body size; moving cold
  work (legacy resolution, long-name scans) out of the hot path matters as
  much as the work itself.
- Keep string and digit-table reads in bounds, including at EOF. An
  out-of-bounds `charCodeAt` returns `NaN`, and a typed-array read returns
  `undefined`; both are valid JavaScript but can deoptimize later calls in
  V8. Benchmarks must warm incomplete names and numeric references as well
  as valid terminated references, or they can miss this slowdown.
- Exact and legacy short-name matches share lookup and emission call sites.
  Separate sites can trigger another optimization pass when legacy inputs
  first exercise them, slowing later ordinary inputs. The shared path also
  removes duplicate lookup and output code.
