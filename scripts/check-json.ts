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

/**
 * Report empty objects and arrays in a manifest field.
 * @param value The field value.
 * @param field The field path.
 */
function checkEmptyFields(value: unknown, field: string): void {
    if (typeof value !== "object" || value === null) return;

    const entries: [string, unknown][] = Object.entries(value);
    if (entries.length === 0) {
        errorMessages.push(`Empty field: ${field}`);
    }
    for (const [key, child] of entries) {
        checkEmptyFields(child, `${field}[${JSON.stringify(key)}]`);
    }
}

for (const [field, value] of Object.entries(manifest)) {
    // An empty files list is valid for npm.
    if (field !== "files") checkEmptyFields(value, field);
}

for (const file of [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.build.json",
    "scripts/benchmark/package.json",
    "scripts/benchmark/package-lock.json",
    "scripts/benchmark/tsconfig.json",
    "scripts/benchmark/oxlint.json",
]) {
    const objectKeys: Set<string>[] = [];
    visit(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
        onObjectBegin() {
            objectKeys.push(new Set());
        },
        onObjectProperty(key, _offset, _length, line) {
            const keys = objectKeys.at(-1)!;
            if (keys.has(key)) {
                errorMessages.push(`${file}:${line + 1}: Duplicate key ${key}`);
            }
            keys.add(key);
        },
        onObjectEnd() {
            objectKeys.pop();
        },
    });
}

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
    throw new Error(`Invalid project JSON\n${errorMessages.join("\n")}`);
}
