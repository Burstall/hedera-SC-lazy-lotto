function lookupLevel(rank) {
	switch (rank) {
	case 0:
		return 'C';
	case 1:
		return 'R';
	case 2:
		return 'SR';
	case 3:
		return 'UR';
	case 4:
		return 'LR';
	case 5:
		return 'SPE';
	default:
		return rank;
	}
}

function getLevel(rankInput) {
	const rankStr = String(rankInput).toUpperCase();
	switch (rankStr) {
	case 'C':
		return 0;
	case 'R':
		return 1;
	case 'SR':
		return 2;
	case 'UR':
		return 3;
	case 'LR':
		return 4;
	case 'SPE':
		return 5;
	default:
		return parseInt(rankStr);
	}
}

module.exports = {
	lookupLevel,
	getLevel,
};