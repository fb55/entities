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

Benchmarked in October 2026 with Node v26.9.0 on AMD Ryzen 7 5800X3D.
Libraries are compared on equivalent operations; for `entities`, these are
`decodeHTML`, `encodeNonAsciiHTML` and `escapeUTF8`. Throughput is in MB/s of
UTF-8 input; higher is better. Each library and input runs in its own process,
and every number is the median of three runs. Run `npm run benchmark` to
reproduce; the inputs are defined in
[`scripts/benchmark/benchmark.ts`](scripts/benchmark/benchmark.ts).

### Decoding

| Input                  |     Size |     entities |     html-entities 2.6.0 |                he 2.0.0 |     parse-entities 4.0.2 |
| ---------------------- | -------: | -----------: | ----------------------: | ----------------------: | -----------------------: |
| Short text             |     49 B |     570 MB/s |  105 MB/s (5.4× slower) | 72.2 MB/s (7.9× slower) |   42.1 MB/s (14× slower) |
| Prose, no references   |  4.0 KiB | 133,446 MB/s | 2,149 MB/s (62× slower) | 2,144 MB/s (62× slower) | 127 MB/s (1,054× slower) |
| Prose, some references |  4.0 KiB |   1,480 MB/s |  293 MB/s (5.1× slower) |  190 MB/s (7.8× slower) |   47.0 MB/s (32× slower) |
| All named references   | 19.9 KiB |     157 MB/s | 56.7 MB/s (2.8× slower) | 30.5 MB/s (5.1× slower) |   12.4 MB/s (13× slower) |
| Numeric references     |  4.0 KiB |     275 MB/s | 38.4 MB/s (7.2× slower) | 33.2 MB/s (8.3× slower) |  51.1 MB/s (5.4× slower) |

### Encoding

| Input          |    Size |   entities |      html-entities 2.6.0 |                he 2.0.0 |
| -------------- | ------: | ---------: | -----------------------: | ----------------------: |
| Short text     |    48 B |   195 MB/s |  65.5 MB/s (3.0× slower) | 20.7 MB/s (9.4× slower) |
| ASCII prose    | 4.0 KiB | 1,110 MB/s | 1,001 MB/s (1.1× slower) |  556 MB/s (2.0× slower) |
| Accented prose | 4.0 KiB |   260 MB/s |   149 MB/s (1.7× slower) | 57.6 MB/s (4.5× slower) |
| CJK and emoji  | 4.0 KiB |   126 MB/s |  45.6 MB/s (2.8× slower) | 28.3 MB/s (4.4× slower) |

### Escaping

| Input      |    Size |   entities |      html-entities 2.6.0 |                 he 2.0.0 |
| ---------- | ------: | ---------: | -----------------------: | -----------------------: |
| Short text |    48 B |   326 MB/s |   146 MB/s (2.2× slower) |   156 MB/s (2.1× slower) |
| Prose      | 4.0 KiB | 4,431 MB/s | 2,502 MB/s (1.8× slower) | 2,654 MB/s (1.7× slower) |
| Markup     | 4.1 KiB |   301 MB/s |   181 MB/s (1.7× slower) |   194 MB/s (1.5× slower) |

Without an `&` in the input, `entities` returns it after a single `indexOf`
scan, which explains the "no references" row.

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

As of October 2026, `entities` is faster than other modules. Still, this is
not a differentiated space and other modules can catch up.

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
