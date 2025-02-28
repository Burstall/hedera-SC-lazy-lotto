function getArgFlag(arg) {
	const customIndex = process.argv.indexOf(`-${arg}`);

	if (customIndex > -1) {
		return true;
	}

	return false;
}

function getArg(arg) {
	const customidx = process.argv.indexOf(`-${arg}`);
	let customValue;

	if (customidx > -1) {
		// Retrieve the value after --custom
		customValue = process.argv[customidx + 1];
	}

	return customValue;
}

async function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function isBytes32(str) {
	return /^0x([A-Fa-f0-9]{64})$/.test(str);
}

module.exports = { getArgFlag, getArg, sleep, isBytes32 };