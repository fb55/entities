import { validate } from "package-json-validator";
import manifest from "../package.json" with { type: "json" };

const { errorMessages } = validate(manifest, true);
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
