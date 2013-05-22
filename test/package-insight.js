
const PATH = require("path");
const ASSERT = require("assert");
const WAITFOR = require("waitfor");
const GLOB = require("glob");
const FS = require("fs-extra");
const PACKAGE_INSIGHT = require("../lib/package-insight");

const MODE = "test";
//const MODE = "write";


describe('package-insight', function() {

	it('should export `parse()`', function() {
		ASSERT(typeof PACKAGE_INSIGHT.parse === "function");
	});

	it('should export `parseDescriptor()`', function() {
		ASSERT(typeof PACKAGE_INSIGHT.parseDescriptor === "function");
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
					        cwd: PATH.join(__dirname, "assets/descriptors")
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
						var options = {};
						if (/\.component\.json$/.test(file)) {
							options.type = "component";
						}
						return PACKAGE_INSIGHT.parseDescriptor(PATH.join(__dirname, "assets/descriptors", file), options, function(err, descriptor) {
							if (err) return done(err);

							try {

								ASSERT(typeof descriptor === "object");

								if (descriptor.errors.length > 0) {
									descriptor.errors.forEach(function(error) {
										var err = new Error("Got '" + error[0] + "' error '" + error[1] + "' for file '" + PATH.join("assets/descriptors", file) + "'");
										err.stack = error[2];
										throw err;
									});
								}

								if (MODE === "test") {
									ASSERT.deepEqual(
										descriptor,
										JSON.parse(FS.readFileSync(PATH.join(__dirname, "assets/descriptors", file.replace(/(\.json)$/, ".insight$1"))))
									);
								} else
								if (MODE === "write") {
									FS.writeFileSync(PATH.join(__dirname, "assets/descriptors", file.replace(/(\.json)$/, ".insight$1")), JSON.stringify(descriptor, null, 4));
								} else {
									throw new Error("Unknown `MODE`");
								}

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