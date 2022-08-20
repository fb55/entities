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
    const hex = encoded.map((v) => v.toString(36)).join(",");

    // Write the encoded trie to disk
    fs.writeFileSync(
        `${__dirname}/../src/generated/decode-data-${name}.ts`,
        `// Generated using scripts/write-decode-map.ts
/* eslint-disable */
// prettier-ignore
export default /* #__PURE__ */ (function () {
    const hex = "${hex}".split(',');
    const arr = new Uint16Array(${encoded.length});
    for (let i = 0; i < arr.length; i++) {
        arr[i] = parseInt(hex[i], 36);
    }
    return arr;
})();
`
    );
}

convertMapToBinaryTrie("xml", xmlMap, {});
convertMapToBinaryTrie("html", entityMap, legacyMap);

console.log("Done!");
