/*jslint node: true */
'use strict';
const obyte = require('obyte');
const { getEnvironment } = require("./environment.js");


let clients = {};
let watchedAAs = {
	mainnet: {},
	testnet: {},
};

/**
 * Get obyte.js client created by the SDK
 * @memberOf counterstake-sdk
 * @param {boolean} testnet
 * @return {Object}
 * @example
 * const obyteClient = getObyteClient(testnet);
 */
function getObyteClient(testnet) {
	const environment = getEnvironment(testnet);
	if (!clients[environment]) {
		clients[environment] = new obyte.Client('wss://obyte.org/bb' + (testnet ? '-test' : ''), { testnet, reconnect: true });
		setInterval(function () {
			clients[environment].api.heartbeat();
		}, 20 * 1000);
	}
	return clients[environment];
}

function watchAA(aa, client) {
	client.justsaying("light/new_aa_to_watch", { aa });
	watchedAAs[getEnvironment(client.options.testnet)][aa] = true;
}

function resumeWatchingAAs(client) {
	for (let aa in watchedAAs[getEnvironment(client.options.testnet)]) {
		console.log(`resubscribing to ${aa}`);
		client.justsaying("light/new_aa_to_watch", { aa });
	}
}

exports.getObyteClient = getObyteClient;
exports.watchAA = watchAA;
exports.resumeWatchingAAs = resumeWatchingAAs;

