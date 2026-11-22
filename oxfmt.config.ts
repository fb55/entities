import { defineConfig } from "oxfmt";

export default defineConfig({
    printWidth: 80,
    tabWidth: 4,
    sortImports: false,
    sortPackageJson: false,
    ignorePatterns: [".*", "maps/", "test/fixtures/html5lib-tests/"],
});
