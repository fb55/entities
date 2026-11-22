import { readFileSync } from "node:fs";
import { visit } from "jsonc-parser";
import { validate, validateFunding } from "package-json-validator";
import manifest from "../package.json" with { type: "json" };

const fields: {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
    peerDependencies?: Record<string, unknown>;
    funding?: unknown;
} = manifest;
const {
    dependencies = {},
    devDependencies = {},
    peerDependencies = {},
    funding,
} = fields;

const { errorMessages } = validate(manifest, true);
const objectKeys: Set<string>[] = [];
visit(readFileSync(new URL("../package.json", import.meta.url), "utf8"), {
    onObjectBegin() {
        objectKeys.push(new Set());
    },
    onObjectProperty(key, _offset, _length, line) {
        const keys = objectKeys.at(-1)!;
        if (keys.has(key)) {
            errorMessages.push(`Duplicate key on line ${line + 1}: ${key}`);
        }
        keys.add(key);
    },
    onObjectEnd() {
        objectKeys.pop();
    },
});

if (funding !== undefined) {
    errorMessages.push(...validateFunding(funding).errorMessages);
}
for (const name of Object.keys(dependencies)) {
    if (
        Object.hasOwn(devDependencies, name) ||
        Object.hasOwn(peerDependencies, name)
    ) {
        errorMessages.push(
            `Dependency also declared in a dev or peer group: ${name}`,
        );
    }
}

for (const field of [
    "description",
    "files",
    "license",
    "repository",
    "sideEffects",
    "type",
]) {
    if (!Object.hasOwn(manifest, field)) {
        errorMessages.push(`Missing required property: ${field}`);
    }
}

if (errorMessages.length > 0) {
    throw new Error(`Invalid package.json\n${errorMessages.join("\n")}`);
}
