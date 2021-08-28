const fetch = typeof window !== 'undefined' && window.fetch ? window.fetch : require('node-fetch');


const cache_lifetime = 10 * 60 * 1000; // 10 minutes

class Cache {
//	data = {};

	get(key) {
		const record = this.data[key];
		if (!record)
			return null;
		if (record.ts < Date.now() - cache_lifetime) // expired
			return null;
		return record.value;
	}

	put(key, value) {
		this.data[key] = { value, ts: Date.now() };
	}

	constructor() {
		this.data = {};
	}
}

const cache = new Cache();

function cachify(func, count_args) {
	return async function() {
		const bForceUpdate = arguments[count_args]; // the last arg is optional
		const args = [];
		for (let i = 0; i < count_args; i++) // not including the 'cached' arg
			args[i] = arguments[i];
		const key = func.name + '_' + args.join(',');
		if (!bForceUpdate) { // use cached value if available
			const value = cache.get(key);
			if (value !== null) {
			//	console.log(`using cached value ${value} for`, func.name, arguments)
				return value;
			}
		}
		const value = await func.apply(null, args);
		cache.put(key, value);
		return value;
	}
}



const request = async (url, options) => {
	const response = await fetch(url, {
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		...options
	});
	if (!response.ok) {
		const error = await response.text();
		console.error('-- error', error);
		throw new Error(error);
	}
	const data = await response.json();
	return data;
}

function getBaseUrl(testnet) {
	return `https://${testnet ? 'testnet-bridge.' : ''}counterstake.org/api`;
}

const fetchBridges = async (testnet) => {
	console.log(`fetching bridges`);
	const data = await request(`${getBaseUrl(testnet)}/bridges`);
	if (data.status !== 'success')
		throw Error(`getting bridges failed ${JSON.stringify(data)}`);
	const bridges = data.data;
//	console.log('bridges', bridges)
	return bridges;
}

/**
 * Query the status of a transfer you previously sent
 * @memberOf counterstake-sdk
 * @param {string} txid
 * @param {boolean} testnet
 * @return {Promise<Object>}
 * @example
 * const transfer = await getTransfer(txid, testnet);
 */
 async function getTransfer(txid, testnet) {
	const data = await request(`${getBaseUrl(testnet)}/transfer/?txid=${encodeURIComponent(txid)}`);
	if (data.status !== 'success')
		throw Error(`getting transfer ${txid} failed ${JSON.stringify(data)}`);
	const transfer = data.data;
//	console.log('transfer', transfer)
	return transfer;
}


/**
 * Get the list of all bridges and information about them
 * @memberOf counterstake-sdk
 * @param {boolean} testnet
 * @param {boolean} bForceUpdate
 * @return {Promise<Array<Object>>}
 * @example
 * const bridges = await getBridges(testnet, bForceUpdate);
 */
const getBridges = cachify(fetchBridges, 1)


exports.getBridges = getBridges;
exports.getTransfer = getTransfer;

