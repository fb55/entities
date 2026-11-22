import { readFileSync } from "node:fs";
import { visit } from "jsonc-parser";
import {
    validate,
    validateBrowser,
    validateDevEngines,
    validateFunding,
    validateGypfile,
    validateLibc,
    validateMain,
    validatePackageManager,
    validatePeerDependenciesMeta,
} from "package-json-validator";
import manifest from "../package.json" with { type: "json" };

const fields: {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
    peerDependencies?: Record<string, unknown>;
    peerDependenciesMeta?: Record<string, unknown>;
} & Record<string, unknown> = manifest;
const {
    dependencies = {},
    devDependencies = {},
    peerDependencies = {},
    peerDependenciesMeta = {},
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

// These fields have validators that are separate from the bulk check.
for (const [field, validator] of Object.entries({
    browser: validateBrowser,
    devEngines: validateDevEngines,
    funding: validateFunding,
    gypfile: validateGypfile,
    libc: validateLibc,
    module: validateMain,
    packageManager: validatePackageManager,
    peerDependenciesMeta: validatePeerDependenciesMeta,
})) {
    if (Object.hasOwn(fields, field)) {
        for (const message of validator(fields[field]).errorMessages) {
            errorMessages.push(`${field}: ${message}`);
        }
    }
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
for (const name of Object.keys(peerDependencies)) {
    if (!Object.hasOwn(devDependencies, name)) {
        errorMessages.push(
            `Peer dependency missing from devDependencies: ${name}`,
        );
    }
}
for (const name of Object.keys(peerDependenciesMeta)) {
    if (!Object.hasOwn(peerDependencies, name)) {
        errorMessages.push(
            `Peer metadata has no corresponding peer dependency: ${name}`,
        );
    }
}

if (
    fields["private"] !== true &&
    !Object.hasOwn(manifest, "author") &&
    !Object.hasOwn(manifest, "contributors")
) {
    errorMessages.push("Missing author or contributors");
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
