
const ASSERT = require("assert");
const WAITFOR = require("waitfor");
const FS = require("fs");


exports.parse = function(packagePath, callback) {
	try {

		ASSERT(FS.existsSync(packagePath));
		ASSERT(FS.statSync(packagePath).isDirectory());

		// TODO: Parse package.

	} catch(err) {
		return callback(err);
	}
}

exports.parseDescriptor = function(descriptorPath, options, callback) {
	try {

		options = options || {};

		var descriptor = {
			raw: {},
			normalized: {},
			warnings: [],
			errors: []
		};

		if (typeof descriptorPath === "string") {
			ASSERT(FS.existsSync(descriptorPath));
			ASSERT(FS.statSync(descriptorPath).isFile());
			descriptor.raw = JSON.parse(FS.readFileSync(descriptorPath));
		} else {
			ASSERT(typeof descriptorPath, "object");
			descriptor.raw  = descriptorPath;
		}

		return normalize(descriptor, options, function(err) {
			if (err) {
				descriptor.errors.push([
					"normalize", err.message, err.stack
				]);
			}
			return callback(null, descriptor);
		});

	} catch(err) {
		return callback(err);
	}
}

// TODO: Normalize the values of the various properties to ensure they all follow standard formats.
function normalize(descriptor, options, callback) {

	var copied = {};

	function string(key) {
		if (typeof descriptor.raw[key] === "string") {
			descriptor.normalized[key] = descriptor.raw[key];
			copied[key] = true;
		}
	}
	function stringToArray(key, targetKey) {
		if (typeof descriptor.raw[key] === "string") {
			anyToArray(key, targetKey);
		}
	}
	function booleanToObject(key, targetKey) {
		if (typeof descriptor.raw[key] === "boolean") {
			anyToObject(key, targetKey);
		}
	}
	function stringToObject(key, targetKey) {
		if (typeof descriptor.raw[key] === "string") {
			anyToObject(key, targetKey);
		}
	}
	function objectToObject(key, targetKey) {
		if (typeof descriptor.raw[key] === "object") {
			if (Object.keys(descriptor.raw[key]).length > 0) {
				anyToObject(key, targetKey);
			}
			copied[key] = true;
		}
	}
	function arrayToObject(key, targetKey) {
		if (descriptor.raw[key] && Array.isArray(descriptor.raw[key])) {
			if (descriptor.raw[key].length > 0) {
				anyToObject(key, targetKey);
			}
			copied[key] = true;
		}
	}
	function array(key) {
		if (descriptor.raw[key] && Array.isArray(descriptor.raw[key])) {
			if (descriptor.raw[key].length > 0) {
				descriptor.normalized[key] = descriptor.raw[key];
			}
			copied[key] = true;
		}
	}
	function object(key) {
		if (descriptor.raw[key] && typeof descriptor.raw[key] === "object") {
			descriptor.normalized[key] = descriptor.raw[key];
			copied[key] = true;
		}
	}
	function mergeObjectTo(key, targetKey) {
		if (descriptor.raw[key] && typeof descriptor.raw[key] === "object") {
			if (typeof targetKey === "string") {
				targetKey = [
					targetKey
				];
			}
			if (!descriptor.normalized[targetKey[0]]) {
				descriptor.normalized[targetKey[0]] = {};
			}
			var target = descriptor.normalized[targetKey[0]];
			if (targetKey.length === 2) {
				if (!target[targetKey[1]]) {
					target[targetKey[1]] = {};
				}
			    target = target[targetKey[1]];
			}

			for (var name in descriptor.raw[key]) {
				if (
					typeof target[name] !== "undefined" &&
					target[name] !== descriptor.raw[key][name]
				) {
					descriptor.warnings.push([
						"normalize", "Found existing value at '" + targetKey.join(".") + "." + name + "' while trying to merge from '" + key + "." + name + "'"
					]);
				} else {
					target[name] = descriptor.raw[key][name];
				}
			}
			copied[key] = true;
		}
	}
	function anyToArray(key, targetKey) {
		if (typeof descriptor.raw[key] !== "undefined") {
			if (!descriptor.normalized[targetKey]) {
				descriptor.normalized[targetKey] = [];
			}
			descriptor.normalized[targetKey].unshift(descriptor.raw[key]);
			copied[key] = true;
		}
	}
	function anyToObject(key, targetKey) {
		if (typeof descriptor.raw[key] !== "undefined") {
			if (typeof targetKey === "string") {
				targetKey = [
					key,
					targetKey
				];
			}
			if (!descriptor.normalized[targetKey[0]]) {
				descriptor.normalized[targetKey[0]] = {};
			}
			descriptor.normalized[targetKey[0]][targetKey[1]] = descriptor.raw[key];
			copied[key] = true;
		}
	}
	function removeIfMatch(key, match) {
		if (descriptor.raw[key] === match) {
			copied[key] = true;
		}
	}
	function remove(key, match) {
		copied[key] = true;
	}

	try {

		string("uid");
		string("name");
		string("description");
		string("version");

		removeIfMatch("_id", descriptor.normalized.name + "@" + descriptor.normalized.version);
		if (typeof descriptor.raw["_from"] === "string") {
			var m = descriptor.raw["_from"].match(/^([^@]*)@(.*?)$/);
			if (m && m[1] === descriptor.normalized.name) {
				if (!descriptor.normalized.locator) {
					descriptor.normalized.locator = {};
				}
				if (
					typeof descriptor.normalized.locator.pointer !== "undefined" &&
					descriptor.normalized.locator.pointer !== m[2]
				) {
					descriptor.warnings.push([
						"normalize", "Found two different values for 'locator.pointer': " + JSON.stringify([
							descriptor.normalized.locator.pointer,
							m[2]
						])
					]);
				} else {
					descriptor.normalized.locator.pointer = m[2];
					copied["_from"] = true;
				}
			}
		}
		mergeObjectTo("dist", "locator");


		object("pm");
		stringToObject("pm", "install");

		string("homepage");

		object("bugs");
		stringToObject("bugs", "url");

		array("repositories");
		anyToArray("repository", "repositories");

		objectToObject("dependencies", ["dependencies", "required"]);
		objectToObject("devDependencies", ["dependencies", "development"]);
		objectToObject("optionalDependencies", ["dependencies", "optional"]);
		arrayToObject("bundledDependencies", ["dependencies", "bundled"]);
		arrayToObject("bundleDependencies", ["dependencies", "bundled"]);

		mergeObjectTo("mappings", ["dependencies", "required"]);
		mergeObjectTo("devMappings", ["dependencies", "development"]);
		mergeObjectTo("optionalMappings", ["dependencies", "optional"]);

		booleanToObject("shrinkwrap", ["config", "shrinkwrap"]);
		objectToObject("publishConfig", ["config", "publish"]);

		objectToObject("engines", ["config", "engines"]);
		mergeObjectTo("engine", ["config", "engines"]);

		objectToObject("engines", ["config", "engines"]);
		objectToObject("os", ["config", "os"]);

		objectToObject("bin", ["config", "bin"]);

		stringToObject("main", ["config", "main"]);

		objectToObject("scripts", ["config", "scripts"]);
		objectToObject("directories", ["config", "directories"]);

		objectToObject("implements", ["config", "implements"]);

		objectToObject("component", ["config", "exports"]);

		object("config");

		if (typeof descriptor.raw.overlay === "object") {
			descriptor.normalized.overlay = {};
		}

		array("licenses");
		anyToArray("license", "licenses");

		remove("readme");
		stringToObject("readmeFilename", ["files", "readme"]);
		anyToObject("man", ["files", "man"]);
		// TODO: `files` -> `files.distribute`
		// TODO: `.distignore` -> `files.distignore`
		// TODO: `.gitignore` -> `files.vcsignore`

		array("keywords");

		array("maintainers");
		array("contributors");
		anyToArray("author", "contributors");


		function processOverlays(callback) {
			if (typeof descriptor.raw.overlay !== "object") {
				return callback(null);
			}
			var waitfor = WAITFOR.serial(function(err) {
				if (err) return callback(err);
				copied["overlay"] = true;
				return callback(null);
			});
			for (var name in descriptor.raw.overlay) {
				waitfor(name, function(name, done) {
					exports.parseDescriptor(descriptor.raw.overlay[name], options, function(err, overlayDescriptor) {
						if (err) return done(err);
						descriptor.normalized.overlay[name] = overlayDescriptor.normalized;
						overlayDescriptor.warnings.forEach(function(warning) {
							warning[0] += "-overlay";
							descriptor.warnings.push(warning);
						});
						overlayDescriptor.errors.forEach(function(error) {
							error[0] += "-overlay";
							descriptor.errors.push(error);
						});
						return done(null);
					});
				});
			}
		}

		return processOverlays(function(err) {
			if (err) return callback(err);

			Object.keys(descriptor.raw).forEach(function(key) {
				if (copied[key]) return;
				descriptor.warnings.push([
					"normalize", "Property '" + key + "' was ignored"
				]);
			});

			return callback(null);

		});

	} catch(err) {
		return callback(err);
	}
};
