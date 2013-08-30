var modes = ["XML", "HTML4", "HTML5"];

module.exports = {
	decode: function(data, level){
		if(!modes[level]) level = 0;
		return module.exports["decode" + modes[level]](data);
	},
	decodeStrict: function(data, level){
		if(!modes[level]) level = 0;
		return module.exports["decode" + modes[level] + "Strict"](data);
	},
	encode: function(data, level){
		if(!modes[level]) level = 0;
		return module.exports["encode" + modes[level]](data);
	}
};

modes.reduce(function(prev, name){
	var obj = require("./entities/" + name.toLowerCase() + ".json");

	if(prev){
		Object.keys(prev).forEach(function(name){
			obj[name] = prev[name];
		});
	}

	module.exports["decode" + name + "Strict"] = getStrictReplacer(obj);

	if(name === "XML"){
		//there is no non-strict mode for XML
		module.exports.decodeXML = module.exports.decodeXMLStrict;
	} else {
		module.exports["decode" + name] = getReplacer(obj);
	}

	module.exports["encode" + name] = getReverse(obj);

	return obj;
}, null);

function getReplacer(obj){
	var keys = Object.keys(obj).sort();
	var re = keys.join("|").replace(/(\w+)\|\1;/g, "$1;?");

	// also match hex and char codes
	re += "|#[xX][\\da-fA-F]+;?|#\\d+;?";

	return genReplaceFunc(
		new RegExp("&(?:" + re + ")", "g"),
		function func(name){
			if(name.charAt(1) === "#"){
				if(name.charAt(2).toLowerCase() === "x"){
					return String.fromCharCode(parseInt(name.substr(3), 16));
				}
				return String.fromCharCode(parseInt(name.substr(2), 10));
			}
			return obj[name.substr(1)];
		}
	);
}

function getStrictReplacer(obj){
	var keys = Object.keys(obj).sort().filter(RegExp.prototype.test, /;$/);
	var re = keys.map(function(name){
		return name.slice(0, -1); //remove trailing semicolon
	}).join("|");

	// also match hex and char codes
	re += "|#[xX][\\da-fA-F]+|#\\d+";

	var expr = new RegExp("&(?:" + re + ");", "g");

	return genReplaceFunc(expr, func);

	function func(name){
			if(name.charAt(1) === "#"){
				if(name.charAt(2).toLowerCase() === "x"){
					return String.fromCharCode(parseInt(name.substr(3), 16));
				}
				return String.fromCharCode(parseInt(name.substr(2), 10));
			}
			return obj[name.substr(1)];
		}
}

var re_nonASCII = /[^\0-\x7F]/g,
    re_astralSymbols = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

function nonUTF8Replacer(c){
	return "&#x" + c.charCodeAt(0).toString(16).toUpperCase() + ";";
}

function astralReplacer(c){
	// http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
	var high = c.charCodeAt(0);
	var low  = c.charCodeAt(1);
	var codePoint = (high - 0xD800) * 0x400 + low - 0xDC00 + 0x10000;
	return "&#x" + codePoint.toString(16).toUpperCase() + ";";
}

function getReverse(obj){
	var reverse = Object.keys(obj).filter(function(name){
		//prefer identifiers with a semicolon
		return name.substr(-1) === ";" || obj[name + ";"] !== obj[name];
	}).reduce(function(reverse, name){
		reverse[obj[name]] = name;
		return reverse;
	}, {});

	var regex = new RegExp("\\" + Object.keys(reverse).sort().join("|\\"), "g");
	function func(name){
		return "&" + reverse[name];
	}

	return function(data){
		return data
				.replace(regex, func)
				.replace(re_astralSymbols, astralReplacer)
				.replace(re_nonASCII, nonUTF8Replacer);
	};
}

function genReplaceFunc(regex, func){
	return function(data){
		return data.replace(regex, func);
	};
}
