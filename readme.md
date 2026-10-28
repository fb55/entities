# entities [![NPM version](https://img.shields.io/npm/v/entities.svg)](https://npmjs.org/package/entities) [![Downloads](https://img.shields.io/npm/dm/entities.svg)](https://npmjs.org/package/entities) [![Node.js CI](https://github.com/fb55/entities/actions/workflows/nodejs-test.yml/badge.svg)](https://github.com/fb55/entities/actions/workflows/nodejs-test.yml)

Encode & decode HTML & XML entities with ease & speed.

## Features

- 😇 Tried and true: `entities` is used by many popular libraries; eg.
  [`htmlparser2`](https://github.com/fb55/htmlparser2), the official
  [AWS SDK](https://github.com/aws/aws-sdk-js-v3) and
  [`commonmark`](https://github.com/commonmark/commonmark.js) use it to process
  HTML entities.
- ⚡️ Fast: `entities` is the fastest library for decoding HTML entities (as of
  September 2025); see [performance](#performance).
- 🎛 Configurable: Get an output tailored for your needs. You are fine with
  UTF8? That'll save you some bytes. Prefer to only have ASCII characters? We
  can do that as well!

## How to…

### …install `entities`

    npm install entities

### …use `entities`

```javascript
import * as entities from "entities";

// Encoding
entities.escapeUTF8("&#38; ü"); // "&amp;#38; ü"
entities.encodeXML("&#38; ü"); // "&amp;#38; &#252;"
entities.encodeHTML("&#38; ü"); // "&amp;&num;38&semi; &uuml;"

// Decoding
entities.decodeXML("asdf &amp; &#xFF; &#xFC; &apos;"); // "asdf & ÿ ü '"
entities.decodeHTML("asdf &amp; &yuml; &uuml; &apos;"); // "asdf & ÿ ü '"
```

## Performance

Benchmarked in October 2026 with Node v26.9.0 on AMD Ryzen 7 5800X3D
(median of three runs). Other libraries are shown relative to `entities`.

### Decoding

| Library              | Short text (49 B) | Plain prose (4.0 KiB) | Prose with references (4.0 KiB) | All named references (19.9 KiB) | Numeric references (4.0 KiB) |
| -------------------- | ----------------: | --------------------: | ------------------------------: | ------------------------------: | ---------------------------: |
| entities             |          578 MB/s |          131,381 MB/s |                      1,425 MB/s |                        161 MB/s |                     272 MB/s |
| html-entities 2.6.0  |       5.5× slower |            61× slower |                     4.8× slower |                     2.7× slower |                  7.1× slower |
| he 2.0.0             |       7.8× slower |            61× slower |                     7.5× slower |                     5.0× slower |                  8.0× slower |
| parse-entities 4.0.2 |        14× slower |         1,040× slower |                      30× slower |                      13× slower |                  5.0× slower |
| ent 2.2.2            |        10× slower |            61× slower |                      10× slower |                     6.9× slower |                   11× slower |

`entities` returns input without `&` after a single `indexOf` scan, hence
the plain prose result.

### Encoding

| Library                  | Short text (48 B) | ASCII prose (4.0 KiB) | Accented prose (4.0 KiB) | CJK and emoji (4.0 KiB) |
| ------------------------ | ----------------: | --------------------: | -----------------------: | ----------------------: |
| entities                 |          195 MB/s |            1,107 MB/s |                 251 MB/s |                127 MB/s |
| html-entities 2.6.0      |       3.0× slower |           1.1× slower |              1.6× slower |             2.7× slower |
| he 2.0.0                 |       9.4× slower |           2.0× slower |              4.3× slower |             4.4× slower |
| stringify-entities 4.0.4 |       8.0× slower |           1.7× slower |              3.8× slower |             5.6× slower |
| ent 2.2.2                |        14× slower |            98× slower |               23× slower |             5.3× slower |

### Escaping

| Library                  | Short text (48 B) | Prose (4.0 KiB) | Markup (4.1 KiB) |
| ------------------------ | ----------------: | --------------: | ---------------: |
| entities                 |          326 MB/s |      4,447 MB/s |         304 MB/s |
| html-entities 2.6.0      |       2.3× slower |     1.8× slower |      1.7× slower |
| he 2.0.0                 |       2.1× slower |     1.7× slower |      1.6× slower |
| stringify-entities 4.0.4 |       3.6× slower |     2.7× slower |      2.8× slower |
| escape-html 1.0.3        |            ≈ same |      12× slower |      1.2× slower |
| html-escaper 3.0.3       |       2.2× slower |     1.7× slower |      1.6× slower |
| lodash 4.18.1            |       2.4× slower |     1.8× slower |      1.7× slower |
| escape-goat 4.0.0        |       3.5× slower |     1.6× slower |      1.2× faster |

### Unescaping

| Library              | Short text (62 B) | Prose (4.1 KiB) | Markup (5.7 KiB) |
| -------------------- | ----------------: | --------------: | ---------------: |
| entities             |          329 MB/s |      4,552 MB/s |         410 MB/s |
| html-entities 2.6.0  |       3.7× slower |     5.7× slower |      3.7× slower |
| he 2.0.0             |       5.2× slower |     8.4× slower |      5.8× slower |
| parse-entities 4.0.2 |       8.0× slower |      75× slower |       13× slower |
| ent 2.2.2            |       7.8× slower |      11× slower |      8.9× slower |
| html-escaper 3.0.3   |       2.8× slower |     5.2× slower |      3.0× slower |
| lodash 4.18.1        |       3.0× slower |     4.8× slower |      3.0× slower |
| escape-goat 4.0.0    |       2.8× slower |     2.3× slower |      1.1× slower |

Note: Micro-benchmarks may vary across machines and Node versions.

---

## FAQ

> What methods should I actually use to encode my documents?

If your target supports UTF-8, the `escapeUTF8` method is going to be your best
choice. Otherwise, use either `encodeHTML` or `encodeXML` based on whether
you're dealing with an HTML or an XML document.

You can have a look at the options for the `encode` and `decode` methods to see
everything you can configure.

> When should I use strict decoding?

When strict decoding, entities not terminated with a semicolon will be ignored.
This is helpful for decoding entities in legacy environments.

> Why should I use `entities` instead of alternative modules?

As of October 2026, `entities` is faster than other modules in nearly all of
the benchmarks above. Still, this is not a differentiated space and other
modules can catch up.

**More importantly**, you might already have `entities` in your dependency graph
(as a dependency of eg. `cheerio`, or `htmlparser2`), and including it directly
might not even increase your bundle size. The same is true for other entity
libraries, so have a look through your `node_modules` directory!

> Does `entities` support tree shaking?

Yes! Note that for best results, you should not use the `encode` and `decode`
functions, as they wrap around a number of other functions, all of which will
remain in the bundle. Instead, use the functions that you need directly.

---

## Acknowledgements

This library wouldn't be possible without the work of these individuals. Thanks
to

- [@mathiasbynens](https://github.com/mathiasbynens) for his explanations about
  character encodings, and his library `he`, which was one of the inspirations
  for `entities`
- [@inikulin](https://github.com/inikulin) for his work on optimized tries for
  decoding HTML entities for the `parse5` project
- [@mdevils](https://github.com/mdevils) for taking on the challenge of
  producing a quick entity library with his `html-entities` library. `entities`
  would be quite a bit slower if there wasn't any competition. Right now
  `entities` is on top, but we'll see how long that lasts!

---

License: BSD-2-Clause

## Security contact information

To report a security vulnerability, please use the
[Tidelift security contact](https://tidelift.com/security). Tidelift will
coordinate the fix and disclosure.
