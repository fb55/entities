import * as entities from ".";

describe("escape HTML", () => {
    it("should escape HTML attribute values", () =>
        expect(entities.escapeAttribute('<a " attr > & value \u00a0!')).toBe(
            "<a &quot; attr > &amp; value &nbsp;!"
        ));

    it("should escape HTML text", () =>
        expect(entities.escapeText('<a " text > & value \u00a0!')).toBe(
            '&lt;a " text &gt; &amp; value &nbsp;!'
        ));
});
