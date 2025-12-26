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

const requestUrls = async (urls, options) => {
	let last_e;
	for (let url of urls) {
		try {
			return await request(url, options);
		}
		catch (e) {
			console.error(`request to ${url} failed:`, e);
			last_e = e;
		}
	}
	throw Error(`all requests failed: ${urls.join(', ')}, last error:`, last_e);
}

// includes a backup API from the watchdog
function getBaseUrls(testnet) {
	return testnet ? [`https://testnet-bridge.counterstake.org/api`] : [`https://counterstake.org/api`, `https://counterstake.org/wd-api`];
}

async function requestPath(path, testnet, options) {
	const urls = getBaseUrls(testnet).map(base_url => base_url + path);
	return await requestUrls(urls, options);
}

const fetchBridges = async (testnet) => {
	console.log(`fetching bridges`);
	const data = await requestPath(`/bridges`, testnet);
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
	const data = await requestPath(`/transfer/?txid=${encodeURIComponent(txid)}`, testnet);
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

