
const PATH = require("path");
const ASSERT = require("assert");
const FS = require("fs-extra");
const WALKER = require("../lib/walker");


describe("walker", function() {

	function createFiles(rootPath, files, callback) {
		function ensureFiles(callback) {
			for (var path in files) {
				FS.outputFileSync(PATH.join(rootPath, path), files[path]);
			}
			return callback(null);
		}
		if (FS.existsSync(rootPath)) {
			FS.remove(rootPath, function(err) {
				if (err) return callback(err);
				return ensureFiles(callback);
			});
		} else {
			return ensureFiles(callback);
		}
	}

    it('should detect subset for `diff` mode', function(done) {
    	var packagePath = PATH.join(__dirname, ".tmp", "walker-1");
    	createFiles(packagePath, {
    		"package.json": "",
    		".git/HEAD": "",
    		"node_modules/pkg1/package.json": "",
    		"node_modules/pkg1/module1.js": "",
    		"node_modules/pkg2/package.json": "",
    		"node_modules/pkg2/module1.js": "",
    		"node_modules/pkg2/.gitignore": [
    			"/module1.js"
    		].join("\n"),
    		"node_modules/pkg1~backup-12345/package.json": ""
    	}, function(err) {
    		if (err) return done(err);
			var walker = new WALKER.Walker(packagePath);
			var options = {};
			options.includeDependencies = true;
			options.respectDistignore = false;
			options.respectNestedIgnore = true;
			return walker.walk(options, function(err, list) {
				if (err) return done(err);
				var length = 0;
				for (var path in list) {
					length +=1 ;
				}
				ASSERT.equal(7, length);
				return done();
	    	});
    	});
    });

});
