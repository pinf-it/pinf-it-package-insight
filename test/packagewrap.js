
const PATH = require("path");
const ASSERT = require("assert");
const WAITFOR = require("waitfor");
const GLOB = require("glob");
const FS = require("fs-extra");
const PACKAGEWRAP = require("../lib/packagewrap");


describe('packagewrap', function() {

	it('should export `parse()`', function() {
		ASSERT(typeof PACKAGEWRAP.parse === "function");
	});

	it('should export `parseDescriptor()`', function() {
		ASSERT(typeof PACKAGEWRAP.parseDescriptor === "function");
	});

	describe('`parseDescriptor()`', function() {

		it('should parse various', function(done) {

			function getFiles(callback) {
				var rules = [
					"npm/*.package.json",
					"commonjs/*.package.json",
					"component/*.component.json"
				];
				var files = [];
				var waitfor = WAITFOR.serial(function(err) {
					if (err) return callback(err);
					return callback(null, files);
				});
				rules.forEach(function(rule) {
					waitfor(function(done) {
						return GLOB(rule, {
					        cwd: PATH.join(__dirname, "assets")
					    }, function (err, paths) {
					        if (err) return done(err);
					        files = files.concat(paths);
					        return done(null);
					    });
					});
				});
			}

			return getFiles(function(err, files) {
				if (err) return done(err);

				var waitfor = WAITFOR.serial(done);
				files.forEach(function(file) {
					waitfor(function(done) {
						return PACKAGEWRAP.parseDescriptor(PATH.join(__dirname, "assets", file), {}, function(err, descriptor) {
							if (err) return done(err);

							try {

								ASSERT(typeof descriptor === "object");

								if (descriptor.errors.length > 0) {
									descriptor.errors.forEach(function(error) {
										var err = new Error("Got '" + error[0] + "' error");
										err.stack = error[2];
										throw err;
									});
								}

								// TODO: Rather than writing file, ensure file is the same as `descriptor`.
								FS.writeFileSync(PATH.join(__dirname, "assets", file.replace(/(\.json)$/, ".parsed$1")), JSON.stringify(descriptor, null, 4));

								return done(null);
							} catch(err) {
								return done(err);
							}
						});
					});
				});
			});
		});
	});

});