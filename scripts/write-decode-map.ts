import * as fs from "node:fs";
import entityMap from "../maps/entities.json" assert { type: "json" };
import legacyMap from "../maps/legacy.json" assert { type: "json" };
import xmlMap from "../maps/xml.json" assert { type: "json" };

import { getTrie } from "./trie/trie.js";
import { encodeTrie } from "./trie/encode-trie.js";

function convertMapToBinaryTrie(
    name: "xml" | "html",
    map: Record<string, string>,
    legacy: Record<string, string>,
) {
    const encoded = encodeTrie(getTrie(map, legacy));
    const stringified = JSON.stringify(String.fromCharCode(...encoded))
        .replace(
            /[^\u0020-\u007E]/g,
            (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
        )
        .replace(/\\u0{4}/g, String.raw`\0`)
        .replace(/\\u00([\da-f]{2})/g, String.raw`\x$1`);

    // Write the encoded trie to disk
    fs.writeFileSync(
        new URL(`../src/generated/decode-data-${name}.ts`, import.meta.url),
        `// Generated using scripts/write-decode-map.ts

export const ${name}DecodeTree: Uint16Array = /* #__PURE__ */ new Uint16Array(
    // prettier-ignore
    /* #__PURE__ */ ${stringified}
        .split("")
        .map((c) => c.charCodeAt(0)),
);
`,
    );
}

convertMapToBinaryTrie("xml", xmlMap, {});
convertMapToBinaryTrie("html", entityMap, legacyMap);

console.log("Done!");
