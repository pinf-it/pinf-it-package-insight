
const DEP = require("dep");

function main() {
	console.log(DEP.main());
}

if (require.main === module) {
	main();
}
