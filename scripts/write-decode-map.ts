import * as fs from "fs";
import entityMap from "../maps/entities.json";
import legacyMap from "../maps/legacy.json";
import xmlMap from "../maps/xml.json";

import { getTrie } from "./trie/trie";
import { encodeTrie } from "./trie/encode-trie";

function convertMapToBinaryTrie(
    name: string,
    map: Record<string, string>,
    legacy: Record<string, string>
) {
    const encoded = encodeTrie(getTrie(map, legacy));
    const stringified = JSON.stringify(String.fromCharCode(...encoded))
        .replace(
            /[^\x20-\x7e]/g,
            (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
        )
        .replace(/\\u0000/g, "\\0")
        .replace(/\\u00([\da-f]{2})/g, "\\x$1");

    // Write the encoded trie to disk
    fs.writeFileSync(
        `${__dirname}/../src/generated/decode-data-${name}.ts`,
        `// Generated using scripts/write-decode-map.ts

export default new Uint16Array(
    // prettier-ignore
    ${stringified}
        .split("")
        .map((c) => c.charCodeAt(0))
);
`
    );
}

convertMapToBinaryTrie("xml", xmlMap, {});
convertMapToBinaryTrie("html", entityMap, legacyMap);

console.log("Done!");
