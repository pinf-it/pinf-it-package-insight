*STATUS: DEV*

Package MetaData Wrapper
========================

Package metadata standards are evolving but there are various differences across communities.

This library attempts to generate a normalized package descriptor and manifest for
any package that adheres to the following standards:

  * [npm](https://npmjs.org/doc/json.html)
  * [CommonJS](http://wiki.commonjs.org/wiki/Packages/1.1)
  * [component](https://github.com/component/component/wiki/Spec)
  * [sm](https://github.com/sourcemint/sm/blob/master/docs/PackageDescriptor.md)


Install
-------

    npm install packagewrap


Usage
-----

	const PACKAGEWRAP = require("packagewrap");

	PACKAGEWRAP.parseDescriptor("<path>" || <object>, {
		type: "<type>" || null
	}, function(err, descriptor) {
		// `descriptor.raw`
		// `descriptor.notmalized`
		// `descriptor.warnings`
		// `descriptor.errors`
	});


Development
-----------

    make test


License
=======

[UNLICENSE](http://unlicense.org/)
