import * as fs from "fs";
import entityMap from "../maps/entities.json";
import legacyMap from "../maps/legacy.json";
import xmlMap from "../maps/xml.json";

import { getTrie } from "./trie/trie.js";
import { encodeTrie } from "./trie/encode-trie.js";

function convertMapToBinaryTrie(
    name: string,
    map: Record<string, string>,
    legacy: Record<string, string>
) {
    const encoded = encodeTrie(getTrie(map, legacy));

    // Write the encoded trie to disk
    fs.writeFileSync(
        `${__dirname}/../src/generated/decode-data-${name}.ts`,
        `// Generated using scripts/write-decode-map.ts
// prettier-ignore
export default new Uint16Array([${encoded
            .map((val) => val.toString(10))
            .join(",")}]);
`
    );
}

convertMapToBinaryTrie("xml", xmlMap, {});
convertMapToBinaryTrie("html", entityMap, legacyMap);

console.log("Done!");
