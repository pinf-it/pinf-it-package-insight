
const GREETING = require("greeting");

function main() {
	console.log(GREETING.getGreeting());
}

if (require.main === module) {
	main();
}
