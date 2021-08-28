/*jslint node: true */
'use strict';


function getEnvironment(testnet) {
	return testnet ? 'testnet' : 'mainnet';
}

exports.getEnvironment = getEnvironment;
