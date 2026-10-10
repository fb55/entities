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

Benchmarked in October 2026 with Node v26.9.0 on AMD Ryzen 7 5800X3D using
`tinybench` 6.2.1 and the versions in `scripts/benchmark/package-lock.json`.
Each task ran for 10 seconds after a 1-second warmup, in three complete runs.
For each library and category, the table uses the run with the median throughput.
Higher ops/s is better; `avg (ns)` is that run's mean time per operation, and `±%`
is its relative margin of error for mean latency at 95% confidence.

To run the current comparison, use `scripts/benchmark/benchmark.ts`. It requires
Node v22+ and installs benchmark dependencies separately from the main development
dependencies:

```sh
npm ci
npm ci --prefix scripts/benchmark
npm --prefix scripts/benchmark run lint
npm run benchmark
```

### Decoding

| Library        | Version | ops/s     | avg (ns) | ±%   | slower |
| -------------- | ------- | --------- | -------- | ---- | ------ |
| entities       | 8.1.0   | 7,078,447 | 144.63   | 1.49 | —      |
| html-entities  | 2.6.0   | 1,789,087 | 576.33   | 2.49 | 74.7%  |
| he             | 2.0.0   | 1,321,673 | 797.93   | 4.70 | 81.3%  |
| parse-entities | 4.0.2   |   782,771 | 1,291.03 | 0.12 | 88.9%  |

### Encoding

| Library       | Version | ops/s     | avg (ns) | ±%   | slower |
| ------------- | ------- | --------- | -------- | ---- | ------ |
| entities      | 8.1.0   | 3,347,934 | 308.15   | 2.36 | —      |
| html-entities | 2.6.0   | 1,163,800 | 878.89   | 2.45 | 65.2%  |
| he            | 2.0.0   |   412,329 | 2,452.05 | 0.30 | 87.7%  |

### Escaping

| Library       | Version | ops/s     | avg (ns) | ±%   | slower |
| ------------- | ------- | --------- | -------- | ---- | ------ |
| entities      | 8.1.0   | 5,156,151 | 198.19   | 0.52 | —      |
| he            | 2.0.0   | 2,745,905 | 380.32   | 3.71 | 46.7%  |
| html-entities | 2.6.0   | 2,463,884 | 415.09   | 1.86 | 52.2%  |

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
