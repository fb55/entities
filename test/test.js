var assert = require('assert');
var entities = require('../');

describe("Encode/decode test", function() {
    var testcases = [
        { input: "asdf & ÿ ü '",
          xml: "asdf &amp; &#255; &#252; &apos;",
          html4: "asdf &amp; &yuml &uuml &apos;",
          html5: "asdf &amp; &yuml &uuml &apos;" },
        { input: '&#38;',
          xml: '&amp;#38;',
          html4: '&amp;#38;',
          html5: '&amp;&num;38&semi;' },
    ];
    testcases.forEach(function(tc) {
        var encodedXML = entities.encodeXML(tc.input);
        it('should XML encode '+tc.input, function() {
            assert.equal(encodedXML, tc.xml);
        });
        it('should XML decode '+encodedXML, function() {
            assert.equal(entities.decodeXML(encodedXML), tc.input);
        });
        var encodedHTML4 = entities.encodeHTML4(tc.input);
        it('should HTML4 encode '+tc.input, function() {
            assert.equal(encodedHTML4, tc.html4);
        });
        it('should HTML4 decode '+encodedHTML4, function() {
            assert.equal(entities.decodeHTML4(encodedHTML4), tc.input);
        });
        var encodedHTML5 = entities.encodeHTML5(tc.input);
        it('should HTML5 encode '+tc.input, function() {
            assert.equal(encodedHTML5, tc.html5);
        });
        it('should HTML5 decode '+encodedHTML5, function() {
            assert.equal(entities.decodeHTML5(encodedHTML5), tc.input);
        });
    });
});
