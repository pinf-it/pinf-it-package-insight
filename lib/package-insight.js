
const ASSERT = require("assert");
const PATH = require("path");
const WAITFOR = require("waitfor");
const DEEPMERGE = require("deepmerge");
const FS = require("fs");


exports.parse = function(packagePath, options, callback) {
	try {
		ASSERT(FS.existsSync(packagePath));
		ASSERT(FS.statSync(packagePath).isDirectory());

		var packageDescriptor = {
			raw: {},
			normalized: {},
			combined: {},
			warnings: [],
			errors: []
		};

		var waitfor = WAITFOR.serial(function(err) {
			if (err) return callback(err);

			return callback(null, packageDescriptor);
		});

		[
			"package.json"
		].forEach(function(filename) {
			waitfor(function(done) {
				return exports.parseDescriptor(PATH.join(packagePath, filename), options, function(err, descriptor) {
					if (err) return done(err);

					packageDescriptor.raw[filename] = descriptor.raw;
					packageDescriptor.normalized[filename] = descriptor.normalized;

					packageDescriptor.combined = DEEPMERGE(packageDescriptor.combined, descriptor.normalized);

					descriptor.warnings.forEach(function(warning) {
						packageDescriptor.warnings.push([].concat(warning, "descriptor", filename));
					});
					descriptor.errors.forEach(function(error) {
						packageDescriptor.errors.push([].concat(error, "descriptor", filename));
					});

					return done(null);
				});
			});
		});
		return waitfor();

	} catch(err) {
		return callback(err);
	}
}

exports.parseDescriptor = function(descriptorPath, options, callback) {
	try {

		options = options || {};

		var descriptor = {
			raw: null,
			normalized: {},
			warnings: [],
			errors: []
		};

		function populateRaw(callback) {
			if (typeof descriptorPath === "string") {
				return FS.exists(descriptorPath, function(exists) {
					if (exists) {
						descriptor.raw = JSON.parse(FS.readFileSync(descriptorPath));
					} else {
						descriptor.raw = {};
					}
					return callback(null);
				});
			} else {
				ASSERT(typeof descriptorPath, "object");
				descriptor.raw  = descriptorPath;
				ASSERT(typeof descriptor.raw, "object");
				descriptorPath = null;
				return callback(null);
			}
		}

		return populateRaw(function(err) {
			if (err) return callback(err);

			return normalize(descriptorPath, descriptor, options, function(err) {
				if (err) {
					descriptor.errors.push([
						"normalize", err.message, err.stack
					]);
				}
				return callback(null, descriptor);
			});
		});

	} catch(err) {
		return callback(err);
	}
}

// TODO: Normalize the values of the various properties to ensure they all follow standard formats.
function normalize(descriptorPath, descriptor, options, callback) {

	var copied = {};

	function string(key) {
		if (typeof descriptor.raw[key] === "string") {
			descriptor.normalized[key] = descriptor.raw[key];
			copied[key] = true;
		}
	}
	function stringToArray(key, targetKey, formatter) {
		if (typeof descriptor.raw[key] === "string") {
			anyToArray(key, targetKey, formatter);
		}
	}
	function booleanToObject(key, targetKey) {
		if (typeof descriptor.raw[key] === "boolean") {
			anyToObject(key, targetKey);
		}
	}
	function stringToObject(key, targetKey, formatter) {
		if (typeof descriptor.raw[key] === "string") {
			anyToObject(key, targetKey, formatter);
		}
	}
	function objectToObject(key, targetKey, formatter) {
		if (typeof descriptor.raw[key] === "object") {
			if (Object.keys(descriptor.raw[key]).length > 0) {
				anyToObject(key, targetKey, formatter);
			}
			copied[key] = true;
		}
	}
	function arrayToObject(key, targetKey, formatter) {
		if (descriptor.raw[key] && Array.isArray(descriptor.raw[key])) {
			if (descriptor.raw[key].length > 0) {
				anyToObject(key, targetKey, formatter);
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
	function anyToArray(key, targetKey, formatter) {
		if (typeof descriptor.raw[key] !== "undefined") {
			if (!descriptor.normalized[targetKey]) {
				descriptor.normalized[targetKey] = [];
			}
			var value = descriptor.raw[key];
			if (typeof formatter === "function") {
				value = formatter(value);
			}
			descriptor.normalized[targetKey].unshift(value);
			copied[key] = true;
		}
	}
	function anyToObject(key, targetKey, formatter) {
		if (typeof descriptor.raw[key] !== "undefined") {
			if (typeof targetKey === "string") {
				targetKey = [
					key,
					targetKey
				];
			}
			if (targetKey[0] === "") {
				targetKey.shift();
			}
			var value = descriptor.raw[key];
			if (typeof formatter === "function") {
				value = formatter(value);
			}
			if (targetKey.length === 1) {
				descriptor.normalized[targetKey[0]] = value;
			} else {
				if (!descriptor.normalized[targetKey[0]]) {
					descriptor.normalized[targetKey[0]] = {};
				}
				if (targetKey.length === 2) {
					descriptor.normalized[targetKey[0]][targetKey[1]] = value;
				} else {
					if (!descriptor.normalized[targetKey[0]][targetKey[1]]) {
						descriptor.normalized[targetKey[0]][targetKey[1]] = {};
					}
					descriptor.normalized[targetKey[0]][targetKey[1]][targetKey[2]] = value;
				}
			}
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
	function prefixRelativePath(path) {
		if (/^(\.|\/)/.test(path)) return path;
		return "./" + path;
	}

	function normalizeSub(label, raw, options, callback) {
		return exports.parseDescriptor(raw, options, function(err, subDescriptor) {
			if (err) return callback(err);
			subDescriptor.warnings.forEach(function(warning) {
				warning[0] += "-" + label;
				descriptor.warnings.push(warning);
			});
			subDescriptor.errors.forEach(function(error) {
				error[0] += "-" + label;
				descriptor.errors.push(error);
			});
			return callback(null, subDescriptor.normalized);
		});
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
		if (options.type === "component") {
			if (!descriptor.normalized.pm) {
				descriptor.normalized.pm = {};
			}
			if (!descriptor.normalized.pm.install) {
				descriptor.normalized.pm.install = "component";
			}
		}

		string("homepage");

		objectToObject("bugs", ["social", "bugs"]);
		stringToObject("bugs", ["social", "bugs", "url"]);
		stringToObject("twitter", ["social", "bugs", "twitter"], function(value) {
			return value.replace(/^@/, "");
		});

		if (options.type === "component") {
			stringToArray("repo", "repositories", function(value) {
				return {
					"type": "git",
		            "url": "http://github.com/" + value + ".git"
				};
			});

			function formatComponentDependencies(value) {
				var dependencies = {};
				for (var id in value) {
					dependencies[id.replace("/", "-")] = {
						repository: {
							"type": "git",
							"url": "http://github.com/" + id + ".git"
						},
						selector: value[id]
					};
				}
				return dependencies;
			}
			objectToObject("dependencies", ["dependencies", "required"], formatComponentDependencies);
			objectToObject("development", ["dependencies", "development"], formatComponentDependencies);

		} else {
			array("repositories");
			anyToArray("repository", "repositories");

			objectToObject("dependencies", ["dependencies", "required"]);
			objectToObject("devDependencies", ["dependencies", "development"]);
			objectToObject("optionalDependencies", ["dependencies", "optional"]);
			arrayToObject("bundledDependencies", ["dependencies", "bundled"]);
			arrayToObject("bundleDependencies", ["dependencies", "bundled"]);
			if (
				descriptor.normalized.dependencies &&
				descriptor.normalized.dependencies.bundled
			) {
				var deps = descriptor.normalized.dependencies.bundled;
				descriptor.normalized.dependencies.bundled = {};
				deps.forEach(function(name) {
					descriptor.normalized.dependencies.bundled[name] = false;
				});
			}

			mergeObjectTo("mappings", ["dependencies", "required"]);
			mergeObjectTo("devMappings", ["dependencies", "development"]);
			mergeObjectTo("optionalMappings", ["dependencies", "optional"]);
		}

		booleanToObject("shrinkwrap", ["config", "shrinkwrap"]);
		objectToObject("publishConfig", ["config", "publish"]);

		objectToObject("engines", ["config", "engines"]);
		mergeObjectTo("engine", ["config", "engines"]);

		objectToObject("engines", ["config", "engines"]);
		objectToObject("os", ["config", "os"]);

		objectToObject("bin", ["config", "bin"]);

		if (options.type === "component") {
		} else {
			objectToObject("scripts", ["config", "scripts"]);
		}

		objectToObject("directories", ["config", "directories"]);

		objectToObject("implements", ["config", "implements"]);

		object("config");

		if (typeof descriptor.raw.overlay === "object") {
			if (typeof descriptor.normalized.overlay === "undefined") {
				descriptor.normalized.overlay = {};
			}
		}

		array("licenses");
		anyToArray("license", "licenses");

		stringToObject("main", ["exports", "main"], prefixRelativePath);

		if (options.type === "component") {
			function formatComponentExports(value) {
				var exports = {};
				if (Array.isArray(value)) {
					value.forEach(function(path) {
						exports[path] = prefixRelativePath(path);
					});
				} else {
					for (var path in value) {
						exports[path] = prefixRelativePath(value[path]);
					}
				}
				return exports;
			}
			anyToObject("scripts", ["exports", "scripts"], formatComponentExports);
			anyToObject("styles", ["exports", "styles"], formatComponentExports);
			anyToObject("images", ["exports", "images"], formatComponentExports);
			anyToObject("fonts", ["exports", "fonts"], formatComponentExports);
			anyToObject("files", ["exports", "resources"], formatComponentExports);
		} else {
			if (typeof descriptor.raw.component === "object") {
				if (typeof descriptor.normalized.exports === "undefined") {
					descriptor.normalized.exports = {};
				}
			}
		}

		remove("readme");
		stringToObject("readmeFilename", ["files", "readme"], prefixRelativePath);		
		anyToObject("man", ["files", "man"]);
		// TODO: `files` -> `files.distribute`
		// TODO: `.distignore` -> `files.distignore`
		// TODO: `.gitignore` -> `files.vcsignore`

		array("keywords");

		array("maintainers");
		array("contributors");
		anyToArray("author", "contributors");


		function processComponent(callback) {
			if (typeof descriptor.raw.component !== "object") {
				return callback(null);
			}
			var opts = {};
			for (var name in options) {
				opts[name] = options[name];
			}
			opts.type = "component";
			return normalizeSub("component", descriptor.raw.component, opts, function(err, normalized) {
				if (err) return callback(err);
				if (typeof normalized.exports === "object") {
					descriptor.normalized.exports = DEEPMERGE(descriptor.normalized.exports || {}, normalized.exports);
					copied["component"] = true;
				}
				return callback(null);
			});
		}

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
					return normalizeSub("overlay", descriptor.raw.overlay[name], options, function(err, normalized) {
						if (err) return done(err);
						descriptor.normalized.overlay[name] = normalized;
						return done(null);
					});
				});
			}
		}

		function detectInstallPM(callback) {
			if (descriptor.normalized.pm && typeof descriptor.normalized.pm.install !== "undefined") {
				return callback(null);
			}
			if (!descriptorPath) {
				return callback(null);
			}
			// TODO: Look for other indicators as well.
			return FS.exists(PATH.join(PATH.dirname(descriptorPath), "node_modules"), function(exists) {
				if (exists || PATH.basename(PATH.dirname(PATH.dirname(descriptorPath))) === "node_modules") {
					if (!descriptor.normalized.pm) {
						descriptor.normalized.pm = {};
					}
					descriptor.normalized.pm.install = "npm";
				}
				return callback(null);
			});
		}

		function detectDependencyDirectory(callback) {
			if (
				descriptor.normalized.config && 
				descriptor.normalized.config.directories &&
				typeof descriptor.normalized.config.directories.dependency !== "undefined"
			) {
				return callback(null);
			}
			if (!descriptorPath) {
				return callback(null);
			}
			return FS.exists(PATH.join(PATH.dirname(descriptorPath), "node_modules"), function(exists) {
				if (
					exists ||
					PATH.basename(PATH.dirname(PATH.dirname(descriptorPath))) === "node_modules" ||
					(
						descriptor.normalized.pm &&
						descriptor.normalized.pm.install === "npm"
					)
				) {
					if (!descriptor.normalized.config) {
						descriptor.normalized.config = {};
					}
					if (!descriptor.normalized.config.directories) {
						descriptor.normalized.config.directories = {};
					}
					descriptor.normalized.config.directories.dependency = "node_modules";
				}
				return callback(null);
			});
		}

		function detectBundledDependencies(callback) {
			if (
				descriptor.normalized.config &&
				descriptor.normalized.config.directories &&
				typeof descriptor.normalized.config.directories.dependency !== "undefined"
			) {
				return FS.exists(PATH.join(PATH.dirname(descriptorPath), descriptor.normalized.config.directories.dependency), function(exists) {
					if (!exists) return callback(null);
					if (!descriptor.normalized.dependencies) {
						descriptor.normalized.dependencies = {};
					}
					if (!descriptor.normalized.dependencies.bundled) {
						descriptor.normalized.dependencies.bundled = {};
					}
					return FS.readdir(PATH.join(PATH.dirname(descriptorPath), descriptor.normalized.config.directories.dependency), function(err, filenames) {
						if (err) return callback(err);
						filenames.forEach(function(filename) {
							descriptor.normalized.dependencies.bundled[filename] = "./" + descriptor.normalized.config.directories.dependency + "/" + filename;
						});
						return callback(null);
					});
				});
			}
			return callback(null);
		}

		function extraNormalization(callback) {

			function normalize(property, callback) {
				if (property === "exports.main" && descriptorPath) {
					if (
						descriptor.normalized.exports &&
						descriptor.normalized.exports &&
						descriptor.normalized.exports.main &&
						!/\.js$/.test(descriptor.normalized.exports.main)
					) {
						var path = PATH.join(PATH.dirname(descriptorPath), descriptor.normalized.exports.main);
						return FS.exists(path, function(exists) {
							if (exists) return callback(null);
							var ext = false;
							if (descriptor.normalized.pm) {
								if (
									descriptor.normalized.pm.install === "npm" ||
									descriptor.normalized.pm.install === "component"
								) {
									ext = ".js";
								}
							}
							path += ext || ".js";
							return FS.exists(path, function(exists) {
								if (exists) {
									descriptor.normalized.exports.main += ".js";
								} else {
									// TODO: Try other common module extensions?
								}
								return callback(null);
							});
						});
					} else
					if (
						!descriptor.normalized.exports ||
						!descriptor.normalized.exports.main
					) {
						var path = PATH.join(PATH.dirname(descriptorPath), "index.js");
						return FS.exists(path, function(exists) {
							if (exists) {
								if (!descriptor.normalized.exports) {
									descriptor.normalized.exports = {};
								}
								descriptor.normalized.exports.main = "./index.js";
							}
							return callback(null);
						});
					}
				} else
				if (property === "config.directories") {
					if (
						descriptor.normalized.config &&
						descriptor.normalized.config.directories
					) {
						for (var type in descriptor.normalized.config.directories) {
							descriptor.normalized.config.directories[type] = prefixRelativePath(descriptor.normalized.config.directories[type]).replace(/\/$/, "")
						}
					}
				}
				return callback(null);
			}

			return normalize("exports.main", function(err) {
				if (err) return callback(err);
				return normalize("config.directories", callback);				
			});
		}

		return processComponent(function(err) {
			if (err) return callback(err);

			return processOverlays(function(err) {
				if (err) return callback(err);

				return detectInstallPM(function(err) {
					if (err) return callback(err);

					return detectDependencyDirectory(function(err) {
						if (err) return callback(err);

						return detectBundledDependencies(function(err) {
							if (err) return callback(err);

							return extraNormalization(function(err) {
								if (err) return callback(err);

								Object.keys(descriptor.raw).forEach(function(key) {
									if (copied[key]) return;
									descriptor.warnings.push([
										"normalize", "Property '" + key + "' was ignored"
									]);
								});

								return callback(null);
							});
						});
					});
				});
			});
		});

	} catch(err) {
		return callback(err);
	}
};
