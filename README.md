*Status: DEV*

Package Insight
===============

Package standards are evolving but there are various differences across communities.

This library attempts to generate a normalized package descriptor and manifest for
any package that adheres to any of the following conventions:

  * [npm](https://npmjs.org/doc/json.html)
  * [CommonJS](http://wiki.commonjs.org/wiki/Packages/1.1)
  * [component](https://github.com/component/component/wiki/Spec)
  * [sm](https://github.com/sourcemint/sm/blob/master/docs/PackageDescriptor.md)


Install
-------

    npm install pinf-it-package-insight


Usage
-----

	const PACKAGE_INSIGHT = require("pinf-it-package-insight");

	PACKAGE_INSIGHT.parseDescriptor("<path>" || <object>, {
		type: "<type>" || null
	}, function(err, descriptor) {
		// `descriptor.raw`
		// `descriptor.notmalized`
		// `descriptor.combined`
		// `descriptor.warnings`
		// `descriptor.errors`
	});


Development
-----------

    npm test


License
=======

[UNLICENSE](http://unlicense.org/)
