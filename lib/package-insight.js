
const ASSERT = require("assert");
const PATH = require("path");
const WAITFOR = require("waitfor");
const DEEPMERGE = require("deepmerge");
const CRYPTO = require("crypto");
const FS = require("fs");
const PINF_PRIMITIVES = require("pinf-primitives-js");


// Descriptors get merged on top of each other in reverse order.
exports.LOOKUP_PATHS = [
	//   4) ./.package.json (~ $PINF_PACKAGE)
	function (ENV) {
		return ENV.PINF_PACKAGE.replace(/\/\.?([^\/]*)$/, "\/.$1");
	},
	//   6) ./package.json
	function (ENV) {
		return ENV.PINF_PACKAGE;
	}
];


exports.findPackagePath = function (basePath, callback) {
	var descriptorPath = PATH.join(basePath, "package.json");
	return FS.exists(descriptorPath, function(exists) {
		if (exists) return callback(null, descriptorPath);
		descriptorPath = PATH.join(basePath, ".package.json");
		return FS.exists(descriptorPath, function(exists) {
			if (exists) return callback(null, descriptorPath);
			var newPath = PATH.dirname(basePath);
			if (newPath === basePath) return callback(null, null);
			return exports.findPackagePath(newPath, callback);
		});
	});
}


exports.parse = function(packagePath, options, callback) {
	try {

		options = options || {};

		options.API = {
			FS: (options.$pinf && options.$pinf.getAPI("FS")) || FS
		};

		options.lookupPaths = options.lookupPaths || exports.LOOKUP_PATHS;

		options._realpath = function(path) {
			if (!options.rootPath) return path;
			if (/^\//.test(path)) return path;
			return PATH.join(options.rootPath, path);
		}

		options._relpath = function(path) {
			if (!path || !options.rootPath || !/^\//.test(path)) return path;
			return PATH.relative(options.rootPath, path);
		}

		ASSERT(options.API.FS.existsSync(options._realpath(packagePath)), "path '" + options._realpath(packagePath) + "' does not exist");

		function bypassIfWeCan(proceedCallback) {
			if (!options.$pinf) {
				return proceedCallback(callback);
			}
			var gateway = options.$pinf.gateway("vfs-write-from-read-mtime-bypass", {
				cacheNamespace: "pinf-it-package-insight",
				verbose: false
			});
			// All criteria that makes this call (argument combination) unique.
			var opts = {};
			for (var name in options) {
				if (name === "$pinf") continue;
				if (name === "API") continue;
				if (/^_/.test(name)) continue;
				if (typeof options[name] === "function") continue;
				opts[name] = options[name];
			}
			var shasum = CRYPTO.createHash("sha1");
			shasum.update(options.lookupPaths.map(function(func) {
				return func.toString();
			}).join(""));
			opts.lookupPaths = shasum.digest("hex");
			shasum = CRYPTO.createHash("sha1");
			shasum.update(JSON.stringify(opts));
			gateway.setKey({
				packagePath: options._realpath(packagePath),
				optionsHash: shasum.digest("hex")
			});
			// NOTE: `callback` will be called by gateway right away if we can bypass.
			return gateway.onDone(callback, function(err, proxiedCallback) {
				if (err) return
				// If callback was triggered above we will get an empty callback back so we can just stop here.
				if (!proxiedCallback) return;
				options.API.FS = gateway.getAPI("FS");
				return proceedCallback(proxiedCallback);
			}, function(cachedData) {
				return callback(null, cachedData);
			});
		}

		return bypassIfWeCan(function(callback) {

			try {

				// TODO: Use async equivalent.
				if (!options.API.FS.statSync(options._realpath(packagePath)).isDirectory()) {
					packagePath = PATH.dirname(packagePath);
				}

				if (options.debug) console.log("[pinf-it-package-insight] parse package: " + packagePath);

				var shasum = CRYPTO.createHash("sha1");
				shasum.update(packagePath);

				var packageDescriptor = {
					dirpath: packagePath,
					dirrealpath: options._relpath(options.API.FS.realpathSync(options._realpath(packagePath))),
					id: shasum.digest("hex") + "-" + PATH.basename(packagePath),
					lookupPaths: [],
					descriptorPaths: [],
					raw: {},
					normalized: {},
					combined: {},
					warnings: [],
					errors: []
				};

				var waitfor = WAITFOR.serial(function(err) {
					if (err) return callback(err);
					return callback(null, packageDescriptor, packageDescriptor);
				});

				var opts = {};
				for (var key in options) {
					opts[key] = options[key];
				}
				opts.packagePath = packagePath;

				var env = PINF_PRIMITIVES.normalizeEnvironmentVariables(null, {
					PINF_PROGRAM: (options.env && options.env.PINF_PROGRAM) || PATH.join(options._realpath(packagePath), "program.json"),
					PINF_PACKAGE: (options.env && options.env.PINF_PACKAGE) || PATH.join(options._realpath(packagePath), "package.json"),
					PINF_MODE: (options.env && options.env.PINF_MODE) || "",
					PINF_RUNTIME: (options.env && options.env.PINF_RUNTIME) || "",
					PINF_PACKAGES: (options.env && options.env.PINF_PACKAGES) || "",
					PINF_PROGRAM_PARENT: (options.env && options.env.PINF_PROGRAM_PARENT) || ""
				});

				// TODO: Get list of files to search from `pinf-for-nodejs/lib/context.LOOKUP_PATHS`. Exclude the 'program' paths.
				(options.lookupPaths).forEach(function(resolve) {

					var filename = options._relpath(resolve(env));
					if (!filename) return;

					waitfor(function(done) {
						return exports.parseDescriptor(filename, opts, function(err, descriptor) {
							if (err) return done(err);

							descriptor.lookupPaths.forEach(function(path) {
								packageDescriptor.lookupPaths.unshift(path);
							});

							if (Object.keys(descriptor.raw).length > 0) {
								descriptor.descriptorPaths.forEach(function(path) {
									packageDescriptor.descriptorPaths.unshift(path);
								});
							}

							filename = PATH.relative(options._realpath(packagePath), options._realpath(filename));

							if (Object.keys(descriptor.raw).length > 0) {
								packageDescriptor.raw[filename] = descriptor.raw;
							}
							packageDescriptor.normalized[filename] = descriptor.normalized;

							packageDescriptor.combined = DEEPMERGE(descriptor.normalized, packageDescriptor.combined);

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
		});

	} catch(err) {
		return callback(err);
	}
}

exports.parseDescriptor = function(descriptorPath, options, callback) {
	try {

		options = options || {};

		options.API = {
			FS: (options.$pinf && options.$pinf.getAPI("FS")) || FS
		};

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
			lookupPaths: [],
			descriptorPaths: [],
			raw: null,
			normalized: {},
			warnings: [],
			errors: []
		};

		function populateRaw(callback) {

			function loadDescriptor(path, callback) {

				var protoBasename = PATH.basename(path).replace(/\.json$/, "");

				function resolveUri(descriptor, uri, callback) {

					uri = uri.replace(/(\/)\*(\.proto\.json)$/, "$1" + protoBasename + "$2");

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
							// TODO: Call normalize on descriptor and get directory from `descriptor.layout.directories.packages` instead of calling `FS.existsSync` and assuming `node_modules`.
							if (options.API.FS.existsSync(PATH.join(options._realpath(options.packagePath), "node_modules"))) {
								packagesPaths.push("./node_modules");
							} else {
								return callback(new Error("`PINF_PACKAGES` env variable or `layout.directories.packages` in descriptor must be set to resolve extends uri '" + uri + "'"));
							}
						}
						packagesPaths.forEach(function(packagesPath) {
							waitfor(function(done) {
								if (foundPath) return done();
								var lookupPath = PATH.join(packagesPath, uri);
								return options.API.FS.exists(options._realpath(lookupPath), function(exists) {
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
					return options.API.FS.readFile(path, function(err, data) {
						if (err) return callback(err);
						var raw = null;
						var obj = null;
						try {
							raw = data.toString();
							// Replace environment variables.
				            // NOTE: We always (unless it is escaped with `\`) replace `$__DIRNAME` with the
				            //       path to the directory holding the descriptor.
							function replaceAll(str, find, replace) {
								while (str.indexOf(find) > -1) {
									str = str.replace(find, replace);
								}
								return str;
							}
							// Temporarily replace all `\\$__DIRNAME` (escaped) so we can keep them.
				            raw = replaceAll(raw, "\\\\$__DIRNAME", "__TMP_tOtAlYrAnDoM__");
				            // Replace all `$__DIRNAME`.
				            raw = raw.replace(/\$__DIRNAME/g, options._relpath(PATH.dirname(path)));
				            // Put back escaped `$__DIRNAME` as the string should be kept.
				            raw = raw.replace(/__TMP_tOtAlYrAnDoM__/g, "$__DIRNAME");
//							if (options.debug) console.log("[pinf] JSON from '" + path + "': ", raw);
							obj = JSON.parse(raw);
						} catch(err) {
							err.message += " (while parsing '" + options._relpath(path) + "')";
							return callback(err);
						}
						if (!obj) return callback(null, raw, null);
						var json = JSON.stringify(obj);
						var waitfor = WAITFOR[options.debug ? "serial" : "parallel"](function(err) {
							if (err) return callback(err);
							try {
//								if (options.debug) console.log("[pinf] JSON from '" + path + "' after injections: ", json);
								obj = JSON.parse(json);
							} catch(err) {
								err.message += " (while parsing '" + options._relpath(path) + "' after injections)";
								return callback(err);
							}
							return callback(null, json, obj);
						});
						var re = /\["<\-","([^"]*)"\]/g;
						var m = null;
						while(m = re.exec(json)) {
							waitfor(m, function(m, done) {
								return resolveUri(obj, m[1], function(err, injectionPath) {
									if (err) return done(err);
									if (!path) {
										if (options.debug) console.log("[pinf] WARN: Injection uri '" + uri + "' could not be resolved to path!");
										return done();
									}
									return options.API.FS.readFile(injectionPath, function(err, raw) {
										if (err) return done(err);
										raw = raw.toString();
										// Replace environment variables.
							            // NOTE: We always replace `$__DIRNAME` with the path to the directory holding the descriptor.
							            raw = raw.replace(/\$__DIRNAME/g, options._relpath(PATH.dirname(injectionPath)));
//										if (options.debug) console.log("[pinf] JSON from '" + path + "': ", raw);
										json = json.replace(m[0], raw);
										return done();
									});
								});
							});
						}
						return waitfor();
					});
				}

				function followExtends(parsed, callback) {
					var extendsList = parsed["@extends"] || parsed["extends"];
					if (!extendsList) {
						return callback(null, parsed);
					}
					var waitfor = WAITFOR.serial(function(err) {
						if (err) return callback(err);
						return callback(null, parsed);
					});
					if (Array.isArray(extendsList)) {
						var arrayExtendsList = extendsList;
						extendsList = {};
						arrayExtendsList.forEach(function (uri, i) {
							extendsList["i:" + i] = uri;
						});
					}
					Object.keys(extendsList).forEach(function (extendsAlias) {
						return waitfor(function(done) {
							var uri = extendsList[extendsAlias];
							if (!uri) {
								return done(null);
							}
							return resolveUri(parsed, uri, function(err, extendsPath) {
								if (err) return done(err);

								if (!extendsPath) {
									if (options.debug) console.log("[pinf] WARN: Extends uri '" + uri + "' declared in '" + path + "' could not be resolved!");
									return done();
								}
								return loadDescriptor(options._realpath(extendsPath), function(err, raw) {
									if (err) return done(err);
									if (raw) {
										try {
											parsed = DEEPMERGE(raw, parsed);
										} catch (err) {
											console.error("Error merging", parsed, "on top of", raw, "loaded from", options._realpath(extendsPath));
											throw err;
										}
									}
									return done();
								});
							});
						});
					});
					delete parsed["@extends"];
					delete parsed["extends"];
					return waitfor();
				}

				descriptor.lookupPaths.push(options._relpath(path));

				return options.API.FS.exists(path, function(exists) {
					if (!exists) {
						return callback(null, null);
					}

					descriptor.descriptorPaths.push(options._relpath(path));

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
							var result = formatter(name, value);
							name = result[0];
							value = result[1];
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

				// If source and target have same key we ignore it so we don't get duplicates.
				// TODO: Ensure this always applies. It may not. Watch the test output!
				if (
					typeof value === "object" &&
					typeof value[targetKey[targetKey.length - 1]] !== "undefined" &&
					Object.keys(value).length === 1
				) {
					value = value[targetKey[targetKey.length - 1]];
				}

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


var addMappingsForPackage__cache = {};

// TODO: Normalize the values of the various properties to ensure they all follow standard formats.
function normalize(descriptorPath, descriptor, options, callback) {

	var copied = {};

	var helpers = exports.makeMergeHelpers(exports, descriptor, copied);

	function realpath(callback) {
		if (!descriptorPath) {
			return callback(null, null);
		}
		return options.API.FS.realpath(options._realpath(descriptorPath), function(err, descriptorRealPath) {
			if (err && err.code !== "ENOENT") {
				return callback(err);
			}
			return callback(null, descriptorRealPath);
		});
	}

	return realpath(function(err, descriptorRealPath) {
		if (err) return callback(err);

		try {

			if (options.ttl === -1)  {
				addMappingsForPackage__cache = {};
			}

			// If `true` will traverse up all parent directories all the way to '/'.
			// If 'node_modules' directories found will make package available if not already
			// for same name (this is consistent with the NodeJS module lookup logic).
			options.mapParentSiblingPackages = (
				descriptor.raw &&
				descriptor.raw.config &&
				descriptor.raw.config["pinf/0/bundler/options/0"] &&
				descriptor.raw.config["pinf/0/bundler/options/0"].mapParentSiblingPackages
			) || false;
			if (options.$pinf && descriptorRealPath) {
				try {
					var info = options.$pinf.getPackageInfo(PATH.dirname(descriptorRealPath));
					if (
						info &&
						info.package &&
						info.package.config &&
						info.package.config["pinf/0/bundler/options/0"] &&
						info.package.config["pinf/0/bundler/options/0"].mapParentSiblingPackages
					) {
						options.mapParentSiblingPackages = info.package.config["pinf/0/bundler/options/0"].mapParentSiblingPackages;
					}
				} catch(err) {}
			}

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

			helpers.mergeObjectTo("imports", "imports");

			helpers.mergeObjectTo("exports", "exports");

			helpers.objectToObject("bin", ["exports", "bin"]);

			if (options.type === "component") {
			} else {
				helpers.objectToObject("scripts", ["exports", "scripts"]);
			}

			helpers.objectToObject("on", ["events", "listen"]);

			helpers.mergeObjectTo("overrides", "overrides");

			helpers.booleanToObject("publish", ["events", "publish"]);

			helpers.objectToObject("env", ["requirements", "env"]);

			helpers.objectToObject("layout", ["layout"]);
			helpers.mergeObjectTo("directories", ["layout", "directories"]);

			helpers.objectToObject("implements", ["config", "implements"]);

			helpers.mergeObjectTo("require.async", "require.async", function(name, value) {
				return [helpers.prefixRelativePath(name), value];
			});

			helpers.object("config");

			if (typeof descriptor.raw.overlay === "object") {
				if (typeof descriptor.normalized.overlay === "undefined") {
					descriptor.normalized.overlay = {};
				}
			}

			helpers.array("licenses");
			helpers.anyToArray("license", "licenses");

			helpers.stringToObject("main", ["exports", "main"], helpers.prefixRelativePath);
			helpers.stringToObject("browser", ["exports", "browser"], helpers.prefixRelativePath);

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
				return options.API.FS.exists(PATH.join(PATH.dirname(options._realpath(descriptorPath)), "node_modules"), function(exists) {
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
				if (
					descriptor.normalized.requirements &&
					descriptor.normalized.requirements.engines &&
					descriptor.normalized.requirements.engines.node
				) {
					if (!descriptor.normalized.layout) {
						descriptor.normalized.layout = {};
					}
					if (!descriptor.normalized.layout.directories) {
						descriptor.normalized.layout.directories = {};
					}
					descriptor.normalized.layout.directories.dependency = "node_modules";
					return callback(null);
				}
				if (!descriptorPath) {
					return callback(null);
				}
				return options.API.FS.exists(PATH.join(PATH.dirname(options._realpath(descriptorPath)), "node_modules"), function(exists) {
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

			function detectBundledDependencies(_callback) {

				function callback () {

					if (!descriptorPath) {
						return _callback(null);
					}

					// Lookup all packages not already found in parent directories.
					function lookup (basePath, packageName, callback) {
						// TODO: Get 'layout.directories.dependency' from parent package instead of assuming ours.
						var lookupPath = PATH.join(basePath, (
							descriptor.normalized.layout &&
							descriptor.normalized.layout.directories &&
							descriptor.normalized.layout.directories.dependency
						) || "", packageName);

						return FS.exists(lookupPath, function (exists) {

							if (!descriptorPath) {
								return callback(null);
							}

							if (exists) {

								if (!descriptor.normalized.dependencies) {
									descriptor.normalized.dependencies = {};
								}
								if (!descriptor.normalized.dependencies.bundled) {
									descriptor.normalized.dependencies.bundled = {};
								}
								descriptor.normalized.dependencies.bundled[packageName] = {
									location: "./" + PATH.relative(PATH.dirname(options._realpath(descriptorPath)), lookupPath)
								};

								// Update path to modules mapped to node_modules that were found in other locations.
								if (descriptor.normalized.dependencies.required[packageName]) {
										Object.keys(descriptor.normalized.dependencies.required).forEach(function(reqName) {
												if (descriptor.normalized.dependencies.required[reqName] === "./node_modules/" + packageName) {
														descriptor.normalized.dependencies.required[reqName] = descriptor.normalized.dependencies.bundled[packageName].location;
												}
										});
								}

								return callback(null);
							}
							if (PATH.dirname(basePath) === basePath) {
								return callback(null);
							}

							if (process.env.PINF_LOOKUP_CEILING) {
									var rel = PATH.relative(PATH.dirname(process.env.PINF_LOOKUP_CEILING), PATH.dirname(basePath));
									if (rel === "" || /^\.\./.test(rel)) {
											if (options.debug) {
													console.log("[pinf-it-package-insight] skip traversing up further for packageName", packageName, "given path", PATH.dirname(basePath), "due to process.env.PINF_LOOKUP_CEILING", process.env.PINF_LOOKUP_CEILING);
											}
											return callback(null);
									}
							}

							return lookup(PATH.dirname(basePath), packageName, callback);
						});
					}
					var waitfor = WAITFOR.serial(_callback);

					for (var type in descriptor.normalized.dependencies) {
						for (var alias in descriptor.normalized.dependencies[type]) {
							if (
								(
									!descriptor.normalized.dependencies ||
									!descriptor.normalized.dependencies.bundled ||
									!descriptor.normalized.dependencies.bundled[alias]
								) &&
								typeof descriptor.normalized.dependencies[type][alias] === "string"
							) {
								waitfor(type, alias, function (type, alias, callback) {

										if (!descriptorPath) {
											return callback(null);
										}

										return FS.exists(options._realpath(PATH.join(descriptorPath, "..", descriptor.normalized.dependencies[type][alias])), function (exists) {
												if (exists) {
														return callback(null);
												}
												return lookup(PATH.join(PATH.dirname(options._realpath(descriptorPath))), alias, callback);
										});
								});
							}
						}
					}
					return waitfor();
				}

				if (
					descriptor.normalized.layout &&
					descriptor.normalized.layout.directories &&
					typeof descriptor.normalized.layout.directories.dependency !== "undefined"
				) {
					return options.API.FS.exists(PATH.join(PATH.dirname(options._realpath(descriptorPath)), descriptor.normalized.layout.directories.dependency), function(exists) {
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
						return options.API.FS.readdir(PATH.join(PATH.dirname(options._realpath(descriptorPath)), descriptor.normalized.layout.directories.dependency), function(err, filenames) {
							if (err) return callback(err);
							filenames.forEach(function(filename) {
								descriptor.normalized.dependencies.bundled[filename] = {
									location: "./" + descriptor.normalized.layout.directories.dependency + "/" + filename
								};
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

				function normalizeEntryPoint (propertyName, callback) {
					if (
						descriptor.normalized.exports &&
						descriptor.normalized.exports[propertyName] &&
						!/\.js$/.test(descriptor.normalized.exports[propertyName])
					) {
						var path = PATH.join(PATH.dirname(options._realpath(descriptorPath)), descriptor.normalized.exports[propertyName]);
						return options.API.FS.exists(path, function(exists) {
							var ext = false;
							if (descriptor.normalized.pm) {
								if (
									descriptor.normalized.pm.install === "npm" ||
									descriptor.normalized.pm.install === "component"
								) {
									ext = ".js";
								}
							}
							ext = ext || ".js";
							function checkIndex(next) {
								if (!exists) return next();
								if (ext !== ".js") return next();
								return FS.exists(PATH.join(path, "index.js"), function(exists) {
									if (exists) {
										descriptor.normalized.exports[propertyName] += "/index.js";
										return callback(null);
									}
									return next();
								});
							}
							return checkIndex(function() {
								return options.API.FS.exists(path + ext, function(exists) {
									if (exists) {
										descriptor.normalized.exports[propertyName] += ext;
									} else {
										// TODO: Try other common module extensions?
									}
									return callback(null);
								});
							});
						});
					} else
					if (
						!descriptor.normalized.exports ||
						!descriptor.normalized.exports[propertyName]
					) {
						var path = PATH.join(PATH.dirname(options._realpath(descriptorPath)), "index.js");
						return options.API.FS.exists(path, function(exists) {
							if (exists) {
								if (!descriptor.normalized.exports) {
									descriptor.normalized.exports = {};
								}
								descriptor.normalized.exports[propertyName] = "./index.js";
							}
							return callback(null);
						});
					}
					return callback(null);
				}

				function normalize(property, callback) {
					if (property === "boot.package") {
						[
							"package",
							"runtime"
						].forEach(function(property) {
							if (
								descriptor.normalized.boot &&
								descriptor.normalized.boot[property] &&
								/^\./.test(descriptor.normalized.boot[property])
							) {
								descriptor.normalized.boot[property] = options._relpath(PATH.join(PATH.dirname(options._realpath(descriptorPath)), descriptor.normalized.boot[property]));
							}
						});
					} else
					if (property === "exports.main" && descriptorPath) {
						return normalizeEntryPoint("main", callback);
					} else
					if (property === "exports.browser" && descriptorPath) {
						return normalizeEntryPoint("browser", callback);
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
							function addMappingsForPackage(packagePath, level, callback) {
								// Only collect mappings up to the root path.
								if (options.rootPath && options._realpath(packagePath).substring(0, options.rootPath.length) !== options.rootPath) {
									return callback(null);
								}
								if (addMappingsForPackage__cache[packagePath]) {
									if (addMappingsForPackage__cache[packagePath] !== true) {
										for (var filename in addMappingsForPackage__cache[packagePath].bundled) {
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
												descriptor.normalized.dependencies.bundled[filename] = {
													location: PATH.relative(options.packagePath, PATH.join(packagePath, "node_modules", filename)) || "."
												};
												descriptor.normalized.mappings[filename] = addMappingsForPackage__cache[packagePath].mappings[filename];
											}
										}
									}
									if (options._realpath(packagePath) === "/") {
										return callback(null);
									}
									if (level >=0 && (!options.mapParentSiblingPackages || level >= options.mapParentSiblingPackages)) return callback(null);
									return addMappingsForPackage(PATH.join(packagePath, ".."), level + 1, callback);
								}
								addMappingsForPackage__cache[packagePath] = true;
								return options.API.FS.exists(PATH.join(options._realpath(packagePath), "node_modules"), function(exists) {
									if (!exists) {
										if (options._realpath(packagePath) === "/") return callback(null);
										if (level >=0 && (!options.mapParentSiblingPackages || level >= options.mapParentSiblingPackages)) {
											return callback(null);
										}
										return addMappingsForPackage(PATH.join(packagePath, ".."), level + 1, callback);
									}

									if (!options.mapParentSiblingPackages) {
										if (options.debug) console.log("[pinf-it-package-insight] Look for packages in parent node_modules directories by setting 'config['pinf/0/bundler/options/0'].mapParentSiblingPackages'");
										return callback(null);
									}

									return options.API.FS.readdir(PATH.join(options._realpath(packagePath), "node_modules"), function(err, filenames) {
										if (err) return callback(err);
										filenames.forEach(function(filename) {
											if (/^\./.test(filename)) return;
											if (!descriptor.normalized.dependencies) {
												descriptor.normalized.dependencies = {};
											}
											if (!descriptor.normalized.dependencies.bundled) {
												descriptor.normalized.dependencies.bundled = {};
											}
											if (!descriptor.normalized.mappings) {
												descriptor.normalized.mappings = {};
											}

											if (!addMappingsForPackage__cache[packagePath] || addMappingsForPackage__cache[packagePath] === true) {
												addMappingsForPackage__cache[packagePath] = {
													bundled: {},
													mappings: {}
												};
											}
											addMappingsForPackage__cache[packagePath].bundled[filename] = {
												location: PATH.relative(options.packagePath, PATH.join(packagePath, "node_modules", filename)) || "."
											};
											var shasum = CRYPTO.createHash("sha1");
											shasum.update(PATH.join(packagePath, "node_modules", filename));
											addMappingsForPackage__cache[packagePath].mappings[filename] = shasum.digest("hex") + "-" + filename;

											if (!descriptor.normalized.mappings[filename]) {
												descriptor.normalized.dependencies.bundled[filename] = addMappingsForPackage__cache[packagePath].bundled[filename];
												descriptor.normalized.mappings[filename] = addMappingsForPackage__cache[packagePath].mappings[filename];
											}
										});
										if (level >=0 && (!options.mapParentSiblingPackages || level >= options.mapParentSiblingPackages)) {
											return callback(null);
										}
										return addMappingsForPackage(PATH.join(packagePath, ".."), level + 1, callback);
									});
								});
							}
							return addMappingsForPackage(PATH.join(options.packagePath, ".."), 0, function(err) {
								if (err) return callback(err);
								return callback(null);
							});
						}
					} else
					if (property === "dependencies") {
						if (descriptor.normalized.dependencies) {
							for (var type in descriptor.normalized.dependencies) {
								for (var alias in descriptor.normalized.dependencies[type]) {
									if (typeof descriptor.normalized.dependencies[type][alias] === "string") {
										var value = descriptor.normalized.dependencies[type][alias];
										// See if we have a path or a selector.
										if (/^\./.test(value)) {
											descriptor.normalized.dependencies[type][alias] = {
												location: value
											};
										} else {
											descriptor.normalized.dependencies[type][alias] = {
												selector: value
											};
										}
									}
								}
							}
						}
					}
					return callback(null);
				}

				return normalize("boot.package", function(err) {
					if (err) return callback(err);
					return normalize("exports.main", function(err) {
						if (err) return callback(err);
						return normalize("exports.browser", function(err) {
							if (err) return callback(err);
							return normalize("layout.directories", function(err) {
								if (err) return callback(err);
								return normalize("mappings", function(err) {
									if (err) return callback(err);
									return normalize("dependencies", callback);
								});
							});
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
										if (options.includeUnknownProperties) {
											descriptor.normalized[key] = descriptor.raw[key];
											copied[key] = true;
										} else {
											descriptor.warnings.push([
												"normalize", "Property '" + key + "' was ignored"
											]);
										}
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
	});
};
