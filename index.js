var re_notUTF8 = /[\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]/g,
	charCode_func = function(c){ return "&#" + c.charCodeAt(0) + ";";};

var fetch = function(filename, inherits){
	var obj = require("./entities/" + filename + ".json");
	
	if(inherits) for(var name in inherits) obj[name] = inherits[name];
	
	var re = Object.keys(obj).sort().join("|").replace(/(\w+)\|\1;/g, "$1;?");
	
	// also match hex and char codes
	re += "|#[xX][0-9a-fA-F]+;?|#\\d+;?";

	return {
		func: function(name){
			if (name.charAt(1) === "#") {
				if (name.charAt(2).toLowerCase() === "x") {
					return String.fromCharCode(parseInt(name.substr(3), 16));
				}
				return String.fromCharCode(parseInt(name.substr(2), 10));
			}
			return obj[name.substr(1)];
		},
		re: new RegExp("&(?:" + re + ")", "g"),
		obj: obj
	};
};

var getReverse = function(obj){
	var reverse = Object.keys(obj).reduce(function(reverse, name){
		reverse[obj[name]] = name;
		return reverse;
	}, {});
	
	return {
		func: function(name){ return "&" + reverse[name]; },
		re: new RegExp("\\" + Object.keys(reverse).sort().join("|\\"), "g")
	};
};

var modes = ["XML", "HTML4", "HTML5"];

module.exports = {
	decode: function(data, level){
		if(!modes[level]) level = 0;
		return module.exports["decode" + modes[level]](data);
	},
	encode: function(data, level){
		if(!modes[level]) level = 0;
		return module.exports["encode" + modes[level]](data);
	}
};

var tmp;

modes.forEach(function(name){
	var obj = fetch(name.toLowerCase(), tmp),
		regex = obj.re,
		func = obj.func;
	
	tmp = obj.obj;
	
	module.exports["decode" + name] = function(data){
		return data
			.replace(regex, func);
	};
	
	var reverse = getReverse(obj.obj),
		reverse_re = reverse.re,
		reverse_func = reverse.func;
	
	module.exports["encode" + name] = function(data){
		return data
			.replace(reverse_re, reverse_func)
			.replace(re_notUTF8, charCode_func);
	};
});
