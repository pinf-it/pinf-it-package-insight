
const ASSERT = require("assert");
const PATH = require("path");
const WAITFOR = require("waitfor");
const DEEPMERGE = require("deepmerge");
const CRYPTO = require("crypto");
const FS = require("fs");


exports.parse = function(packagePath, options, callback) {
	try {

		options = options || {};

		options._realpath = function(path) {
			if (!options.rootPath) return path;
			if (/^\//.test(path)) return path;
			return PATH.join(options.rootPath, path);
		}

		ASSERT(FS.existsSync(options._realpath(packagePath)), "path '" + options._realpath(packagePath) + "' does not exist");
		ASSERT(FS.statSync(options._realpath(packagePath)).isDirectory());

		var shasum = CRYPTO.createHash("sha1");
		shasum.update(packagePath);

		var packageDescriptor = {
			dirpath: packagePath,
			id: shasum.digest("hex") + "-" + PATH.basename(packagePath),
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

		var opts = {};
		for (var key in options) {
			opts[key] = options[key];
		}
		opts.packagePath = packagePath;

		// TODO: Get list of files to search from `pinf-for-nodejs/lib/context.LOOKUP_PATHS`. Exclude the 'program' paths.
		(options.lookupPaths || [
			"package.json"
		]).forEach(function(filename) {
			waitfor(function(done) {
				return exports.parseDescriptor(PATH.join(packagePath, filename), opts, function(err, descriptor) {
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

		options.packagePath = options.packagePath || PATH.dirname(descriptorPath);

		options._realpath = function(path) {
			if (!options.rootPath) return path;
			if (/^\//.test(path)) return path;
			return PATH.join(options.rootPath, path);
		}

		options._relpath = function(path) {
			if (!path || !options.rootPath || !/^\//.test(path)) return path;
			return PATH.relative(options.rootPath, path);
		}

		var descriptor = {
			raw: null,
			normalized: {},
			warnings: [],
			errors: []
		};

		function populateRaw(callback) {

			function loadDescriptor(path, callback) {

				function resolveUri(descriptor, uri, callback) {
					// If `uri` is relative we make it absolute.
					if (/^\./.test(uri)) {
						uri = PATH.join(PATH.dirname(path), uri);
					}
					// If no descriptor filename specified we append default.
					if (!/\.json$/.test(uri)) {
						uri = PATH.join(uri, PATH.basename(path).replace(".json", ".prototype.json"));
					}
					// If we don't have an absolute path we resolve it against the 'PINF_PACKAGES' paths.
					if (!/^\//.test(uri)) {
						var foundPath = null;
						var waitfor = WAITFOR.serial(function(err) {
							if (err) return callback(err);
							return callback(null, foundPath);
						});
						var env = options.env || process.env;
						var packagesPaths = [];
					    var dirs = (descriptor.layout && descriptor.layout.directories) || descriptor.directories || {};
					    if (dirs.packages) {
					    	dirs.packages.split(":").forEach(function(subPath) {
					    		packagesPaths.push(options._relpath(PATH.join(PATH.dirname(path), subPath)));
					    	});
						}
						if (env.PINF_PACKAGES) {
							packagesPaths = packagesPaths.concat(env.PINF_PACKAGES.split(":").map(options._relpath));
						}
						if (packagesPaths.length === 0) {
							return callback(new Error("`PINF_PACKAGES` env variable or `layout.directories.packages` in descriptor must be set to resolve extends uri '" + uri + "'"));
						}
						packagesPaths.forEach(function(packagesPath) {
							waitfor(function(done) {
								if (foundPath) return done();
								var lookupPath = PATH.join(packagesPath, uri);
								return FS.exists(options._realpath(lookupPath), function(exists) {
									if (exists) {
										foundPath = lookupPath;
									}
									return done();
								});
							});
						});
						return waitfor();
					} else {
						return callback(null, uri);
					}
				}

				function loadAugmentAndParseJSON(callback) {
					return FS.readFile(path, function(err, data) {
						if (err) return callback(err);
						var raw = null;
						var obj = null;
						try {
							raw = data.toString();
							// Replace environment variables.
				            // NOTE: We always replace `$__DIRNAME` with the path to the directory holding the descriptor.
				            raw = raw.replace(/\$__DIRNAME/g, options._relpath(PATH.dirname(path)));
							if (options.debug) console.log("[pinf] JSON from '" + path + "': ", raw);
							obj = JSON.parse(raw);
						} catch(err) {
							err.message += " (while parsing '" + path + "')";
							return callback(err);
						}
						if (!obj) return callback(null, raw, null);
						var json = JSON.stringify(obj);
						var waitfor = WAITFOR.parallel(function(err) {
							if (err) return callback(err);
							try {
								if (options.debug) console.log("[pinf] JSON from '" + path + "' after injections: ", json);
								obj = JSON.parse(json);
							} catch(err) {
								err.message += " (while parsing '" + path + "' after injections)";
								return callback(err);
							}
							return callback(null, json, obj);
						});
						var re = /(\["<\-","([^"]*)"\])/g;
						var m = null;
						while(m = re.exec(json)) {
							waitfor(m, function(m, done) {
								return resolveUri(obj, m[2], function(err, injectionPath) {
									if (err) return done(err);
									if (!path) {
										if (options.debug) console.log("[pinf] WARN: Injection uri '" + uri + "' could not be resolved to path!");
										return done();
									}
									return FS.readFile(injectionPath, function(err, raw) {
										if (err) return done(err);
										raw = raw.toString();
										// Replace environment variables.
							            // NOTE: We always replace `$__DIRNAME` with the path to the directory holding the descriptor.
							            raw = raw.replace(/\$__DIRNAME/g, options._relpath(PATH.dirname(injectionPath)));
										if (options.debug) console.log("[pinf] JSON from '" + path + "': ", raw);
										json = json.replace(m[1], raw);
										return done();
									});
								});
							});
						}
						return waitfor();
					});
				}

				function followExtends(parsed, callback) {
					if (!parsed["@extends"]) {
						return callback(null, parsed);
					}
					try {
						if (!Array.isArray(parsed["@extends"])) {
							throw new Error("'@extends' value in descriptor '" + path + "' is not an array!");
						}
					} catch(err) {
						return callback(err);
					}
					var waitfor = WAITFOR.serial(function(err) {
						if (err) return callback(err);
						return callback(null, parsed);
					});
					parsed["@extends"].forEach(function(uri) {
						return waitfor(function(done) {
							return resolveUri(parsed, uri, function(err, extendsPath) {
								if (err) return done(err);
								if (!extendsPath) {
									if (options.debug) console.log("[pinf] WARN: Extends uri '" + uri + "' declared in '" + path + "' could not be resolved!");
									return done();
								}
								return loadDescriptor(options._realpath(extendsPath), function(err, raw) {
									if (err) return done(err);
									parsed = DEEPMERGE(raw, parsed);
									return done();
								});
							});
						});
					});
					delete parsed["@extends"];
					return waitfor();
				}

				return FS.exists(path, function(exists) {
					if (!exists) {
						return callback(null, null);
					}
					return loadAugmentAndParseJSON(function(err, serialized, unserialized) {
						if (err) return callback(err);
						return followExtends(unserialized, callback);
					});
				});
			}

			if (typeof descriptorPath === "string") {
				return loadDescriptor(options._realpath(descriptorPath), function(err, raw) {
					if (err) return callback(err);
					descriptor.raw = raw || {};
					return callback(null);
				})
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


exports.makeMergeHelpers = function(exports, descriptor, copied) {

	var helpers = {
		string: function(key) {
			if (typeof descriptor.raw[key] === "string") {
				descriptor.normalized[key] = descriptor.raw[key];
				copied[key] = true;
			}
		},
		stringToArray: function(key, targetKey, formatter) {
			if (typeof descriptor.raw[key] === "string") {
				helpers.anyToArray(key, targetKey, formatter);
			}
		},
		booleanToObject: function(key, targetKey) {
			if (typeof descriptor.raw[key] === "boolean") {
				helpers.anyToObject(key, targetKey);
			}
		},
		stringToObject: function(key, targetKey, formatter) {
			if (typeof descriptor.raw[key] === "string") {
				helpers.anyToObject(key, targetKey, formatter);
			}
		},
		objectToObject: function(key, targetKey, formatter) {
			if (typeof descriptor.raw[key] === "object") {
				if (Object.keys(descriptor.raw[key]).length > 0) {
					helpers.anyToObject(key, targetKey, formatter);
				}
				copied[key] = true;
			}
		},
		arrayToObject: function(key, targetKey, formatter) {
			if (descriptor.raw[key] && Array.isArray(descriptor.raw[key])) {
				if (descriptor.raw[key].length > 0) {
					helpers.anyToObject(key, targetKey, formatter);
				}
				copied[key] = true;
			}
		},
		array: function(key) {
			if (descriptor.raw[key] && Array.isArray(descriptor.raw[key])) {
				if (descriptor.raw[key].length > 0) {
					descriptor.normalized[key] = descriptor.raw[key];
				}
				copied[key] = true;
			}
		},
		object: function(key) {
			if (descriptor.raw[key] && typeof descriptor.raw[key] === "object") {
				descriptor.normalized[key] = descriptor.raw[key];
				copied[key] = true;
			}
		},
		mergeObjectTo: function(key, targetKey, formatter) {
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
						var value = descriptor.raw[key][name];
						if (typeof formatter === "function") {
							value = formatter(value);
						}
						target[name] = value;
					}
				}
				copied[key] = true;
			}
		},
		anyToArray: function(key, targetKey, formatter) {
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
		},
		anyToObject: function(key, targetKey, formatter) {
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
		},
		removeIfMatch: function(key, match) {
			if (descriptor.raw[key] === match) {
				copied[key] = true;
			}
		},
		remove: function(key, match) {
			copied[key] = true;
		},
		prefixRelativePath: function(path) {
			if (/^(\.|\/)/.test(path)) return path;
			return "./" + path;
		},
		normalizeSub: function(label, raw, options, callback) {
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
	};
	return helpers;
}


// TODO: Normalize the values of the various properties to ensure they all follow standard formats.
function normalize(descriptorPath, descriptor, options, callback) {

	var copied = {};

	var helpers = exports.makeMergeHelpers(exports, descriptor, copied);

	try {

		helpers.anyToArray("@extends", "@extends");

		helpers.string("uid");
		helpers.string("name");
		helpers.string("description");
		helpers.string("version");

		helpers.removeIfMatch("_id", descriptor.normalized.name + "@" + descriptor.normalized.version);
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

		helpers.mergeObjectTo("boot", "boot");

		helpers.mergeObjectTo("dist", "locator");


		helpers.object("pm");
		helpers.stringToObject("pm", "install");
		if (options.type === "component") {
			if (!descriptor.normalized.pm) {
				descriptor.normalized.pm = {};
			}
			if (!descriptor.normalized.pm.install) {
				descriptor.normalized.pm.install = "component";
			}
		}

		helpers.string("homepage");

		helpers.objectToObject("bugs", ["social", "bugs"]);
		helpers.stringToObject("bugs", ["social", "bugs", "url"]);
		helpers.stringToObject("twitter", ["social", "bugs", "twitter"], function(value) {
			return value.replace(/^@/, "");
		});

		if (options.type === "component") {
			helpers.stringToArray("repo", "repositories", function(value) {
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
			helpers.objectToObject("dependencies", ["dependencies", "required"], formatComponentDependencies);
			helpers.objectToObject("development", ["dependencies", "development"], formatComponentDependencies);

		} else {
			helpers.array("repositories");
			helpers.anyToArray("repository", "repositories");

			helpers.objectToObject("dependencies", ["dependencies", "required"]);
			helpers.objectToObject("devDependencies", ["dependencies", "development"]);
			helpers.objectToObject("optionalDependencies", ["dependencies", "optional"]);
			helpers.arrayToObject("bundledDependencies", ["dependencies", "bundled"]);
			helpers.arrayToObject("bundleDependencies", ["dependencies", "bundled"]);
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

			helpers.mergeObjectTo("mappings", ["dependencies", "required"]);
			helpers.mergeObjectTo("devMappings", ["dependencies", "development"]);
			helpers.mergeObjectTo("optionalMappings", ["dependencies", "optional"]);
		}

		helpers.booleanToObject("shrinkwrap", ["config", "shrinkwrap"]);
		helpers.objectToObject("publishConfig", ["config", "publish"]);

		helpers.objectToObject("engines", ["requirements", "engines"]);
		helpers.mergeObjectTo("engine", ["requirements", "engines"]);

		helpers.objectToObject("engines", ["requirements", "engines"]);
		helpers.objectToObject("os", ["config", "os"]);

		helpers.objectToObject("bin", ["config", "bin"]);

		if (options.type === "component") {
		} else {
			helpers.objectToObject("scripts", ["exports", "scripts"]);
		}

		helpers.objectToObject("on", ["events", "listen"]);

		helpers.objectToObject("env", ["requirements", "env"]);

		helpers.objectToObject("layout", ["layout"]);
		helpers.mergeObjectTo("directories", ["layout", "directories"]);

		helpers.objectToObject("implements", ["config", "implements"]);

		helpers.object("config");

		if (typeof descriptor.raw.overlay === "object") {
			if (typeof descriptor.normalized.overlay === "undefined") {
				descriptor.normalized.overlay = {};
			}
		}

		helpers.array("licenses");
		helpers.anyToArray("license", "licenses");

		helpers.stringToObject("main", ["exports", "main"], helpers.prefixRelativePath);

		if (options.type === "component") {
			function formatComponentExports(value) {
				var exports = {};
				if (Array.isArray(value)) {
					value.forEach(function(path) {
						exports[path] = helpers.prefixRelativePath(path);
					});
				} else {
					for (var path in value) {
						exports[path] = helpers.prefixRelativePath(value[path]);
					}
				}
				return exports;
			}
			helpers.anyToObject("scripts", ["exports", "scripts"], formatComponentExports);
			helpers.anyToObject("styles", ["exports", "styles"], formatComponentExports);
			helpers.anyToObject("images", ["exports", "images"], formatComponentExports);
			helpers.anyToObject("fonts", ["exports", "fonts"], formatComponentExports);
			helpers.anyToObject("files", ["exports", "resources"], formatComponentExports);
		} else {
			if (typeof descriptor.raw.component === "object") {
				if (typeof descriptor.normalized.exports === "undefined") {
					descriptor.normalized.exports = {};
				}
			}
		}

		helpers.remove("readme");
		helpers.stringToObject("readmeFilename", ["files", "readme"], helpers.prefixRelativePath);		
		helpers.anyToObject("man", ["files", "man"]);
		// TODO: `files` -> `files.distribute`
		// TODO: `.distignore` -> `files.distignore`
		// TODO: `.gitignore` -> `files.vcsignore`

		helpers.array("keywords");

		helpers.array("maintainers");
		helpers.array("contributors");
		helpers.anyToArray("author", "contributors");


		function processComponent(callback) {
			if (typeof descriptor.raw.component !== "object") {
				return callback(null);
			}
			var opts = {};
			for (var name in options) {
				opts[name] = options[name];
			}
			opts.type = "component";
			return helpers.normalizeSub("component", descriptor.raw.component, opts, function(err, normalized) {
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
					return helpers.normalizeSub("overlay", descriptor.raw.overlay[name], options, function(err, normalized) {
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
			return FS.exists(PATH.join(PATH.dirname(options._realpath(descriptorPath)), "node_modules"), function(exists) {
				if (exists || PATH.basename(PATH.dirname(PATH.dirname(options._realpath(descriptorPath)))) === "node_modules") {
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
				descriptor.normalized.layout && 
				descriptor.normalized.layout.directories &&
				typeof descriptor.normalized.layout.directories.dependency !== "undefined"
			) {
				return callback(null);
			}
			if (!descriptorPath) {
				return callback(null);
			}
			return FS.exists(PATH.join(PATH.dirname(options._realpath(descriptorPath)), "node_modules"), function(exists) {
				if (
					exists ||
					PATH.basename(PATH.dirname(PATH.dirname(options._realpath(descriptorPath)))) === "node_modules" ||
					(
						descriptor.normalized.pm &&
						descriptor.normalized.pm.install === "npm"
					)
				) {
					if (!descriptor.normalized.layout) {
						descriptor.normalized.layout = {};
					}
					if (!descriptor.normalized.layout.directories) {
						descriptor.normalized.layout.directories = {};
					}
					descriptor.normalized.layout.directories.dependency = "node_modules";
				}
				return callback(null);
			});
		}

		function detectBundledDependencies(callback) {
			if (
				descriptor.normalized.layout &&
				descriptor.normalized.layout.directories &&
				typeof descriptor.normalized.layout.directories.dependency !== "undefined"
			) {
				return FS.exists(PATH.join(PATH.dirname(options._realpath(descriptorPath)), descriptor.normalized.layout.directories.dependency), function(exists) {
					if (!exists) return callback(null);
					if (!descriptor.normalized.dependencies) {
						descriptor.normalized.dependencies = {};
					}
					if (!descriptor.normalized.dependencies.bundled) {
						descriptor.normalized.dependencies.bundled = {};
					}
					if (!descriptor.normalized.mappings) {
						descriptor.normalized.mappings = {};
					}
					return FS.readdir(PATH.join(PATH.dirname(options._realpath(descriptorPath)), descriptor.normalized.layout.directories.dependency), function(err, filenames) {
						if (err) return callback(err);
						filenames.forEach(function(filename) {
							descriptor.normalized.dependencies.bundled[filename] = "./" + descriptor.normalized.layout.directories.dependency + "/" + filename;

							var shasum = CRYPTO.createHash("sha1");
							shasum.update(PATH.join(options.packagePath, descriptor.normalized.layout.directories.dependency, filename));
							descriptor.normalized.mappings[filename] = shasum.digest("hex") + "-" + filename;
						});
						return callback(null);
					});
				});
			}
			return callback(null);
		}

		function extraNormalization(callback) {

			function normalize(property, callback) {
				if (property === "boot.package") {
					if (
						descriptor.normalized.boot &&
						descriptor.normalized.boot.package &&
						/^\./.test(descriptor.normalized.boot.package)
					) {
						descriptor.normalized.boot.package = options._relpath(PATH.join(PATH.dirname(options._realpath(descriptorPath)), descriptor.normalized.boot.package));
					}
				} else
				if (property === "exports.main" && descriptorPath) {
					if (
						descriptor.normalized.exports &&
						descriptor.normalized.exports.main &&
						!/\.js$/.test(descriptor.normalized.exports.main)
					) {
						var path = PATH.join(PATH.dirname(options._realpath(descriptorPath)), descriptor.normalized.exports.main);
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
						var path = PATH.join(PATH.dirname(options._realpath(descriptorPath)), "index.js");
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
				if (property === "layout.directories") {
					if (
						descriptor.normalized.layout &&
						descriptor.normalized.layout.directories
					) {
						for (var type in descriptor.normalized.layout.directories) {
							descriptor.normalized.layout.directories[type] = helpers.prefixRelativePath(descriptor.normalized.layout.directories[type]).replace(/\/$/, "")
						}
					}
				} else
				if (property === "mappings") {
					if (descriptor.normalized.pm && descriptor.normalized.pm.install === "npm") {
						function addMappingsForPackage(packagePath, callback) {
							return FS.exists(PATH.join(options._realpath(packagePath), "node_modules"), function(exists) {
								if (!exists) return callback(null);
								return FS.readdir(PATH.join(options._realpath(packagePath), "node_modules"), function(err, filenames) {
									if (err) return callback(err);
									filenames.forEach(function(filename) {
										var relpath = PATH.relative(options.packagePath, PATH.join(packagePath, "node_modules", filename));
										if (relpath === "") return;
										if (!descriptor.normalized.dependencies) {
											descriptor.normalized.dependencies = {};
										}
										if (!descriptor.normalized.dependencies.bundled) {
											descriptor.normalized.dependencies.bundled = {};
										}
										if (!descriptor.normalized.mappings) {
											descriptor.normalized.mappings = {};
										}
										if (!descriptor.normalized.mappings[filename]) {
											descriptor.normalized.dependencies.bundled[filename] = relpath;
											var shasum = CRYPTO.createHash("sha1");
											shasum.update(PATH.join(packagePath, "node_modules", filename));
											descriptor.normalized.mappings[filename] = shasum.digest("hex") + "-" + filename;
										}
									});
									return addMappingsForPackage(PATH.join(packagePath, "../.."), callback);
								});
							});
						}
						return addMappingsForPackage(PATH.join(options.packagePath, "../.."), callback);
					}
				}
				return callback(null);
			}

			return normalize("boot.package", function(err) {
				if (err) return callback(err);
				return normalize("exports.main", function(err) {
					if (err) return callback(err);
					return normalize("layout.directories", function(err) {
						if (err) return callback(err);
						return normalize("mappings", callback);				
					});
				});
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
