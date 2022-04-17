/*jslint node: true */
'use strict';
const { getPoolState, getSwapParams } = require('oswap-v2-sdk');
const { isValidAddress } = require('obyte/lib/utils');
const { getEnvironment } = require("./environment.js");
const { getObyteClient } = require("./obyte-client.js");


const oswap_factory_aas = {
	testnet: 'OQLU4HOAIVJ32SDVBJA6AKD52OVTHAOF',
	mainnet: 'OQLU4HOAIVJ32SDVBJA6AKD52OVTHAOF',
};


let poolParams = {};

let cachedPoolsByPair = {};
const pools_by_pair_cache_timeout = 24 * 3600 * 1000; // 24 hours

let cachedPoolVars = {};
const pool_vars_cache_timeout = 5 * 60 * 1000; // 5 min


/**
 * Find an Oswap pool that connects `from_asset` and `to_asset`
 * @memberOf counterstake-sdk
 * @param {string} from_asset
 * @param {string} to_asset
 * @param {boolean} testnet
 * @param {Object} obyteClient
 * @return {Promise<?string>}
 * @example
 * const pool = await findOswapPool(from_asset, to_asset, testnet, obyteClient);
 */
async function findOswapPool(from_asset, to_asset, testnet, obyteClient) {
	if (!from_asset || !to_asset)
		throw Error("from_asset or to_asset isn't valid");
	const pair = from_asset > to_asset ? from_asset + '_' + to_asset : to_asset + '_' + from_asset;
	if (cachedPoolsByPair[pair] && cachedPoolsByPair[pair].ts > Date.now() - pools_by_pair_cache_timeout)
		return cachedPoolsByPair[pair].pool;
	const client = obyteClient || getObyteClient(testnet);
	const var_prefix = 'pool_';
	const vars = await client.api.getAaStateVars({ address: oswap_factory_aas[getEnvironment(testnet)], var_prefix });
	let pools = [];
	for (let var_name in vars) {
		const pool = var_name.substring(var_prefix.length);
		const { x_asset, y_asset } = vars[var_name];
		if (x_asset === from_asset && y_asset === to_asset || x_asset === to_asset && y_asset === from_asset)
			pools.push(pool);
	}
	console.log(`oswap pools for ${from_asset} to ${to_asset}`, pools);
	if (pools.length === 0)
		return null;
	let best_pool;
	if (pools.length === 1) {
		best_pool = pools[0];
	}
	else {
		// find the pool with most liquidity
		const balances = await client.api.getBalances(pools);
		let max_balance_from = 0;
		for (let pool of pools) {
			const balance = balances[pool][from_asset] ? balances[pool][from_asset].total : 0;
			if (balance > max_balance_from) {
				max_balance_from = balance;
				best_pool = pool;
			}
		}
		// best_pool can stay undefined if all pools are empty
	}
	if (best_pool) {
		cachedPoolsByPair[pair] = {
			pool: best_pool,
			ts: Date.now(),
		};
	}
	return best_pool;
}


async function getPoolParams(pool, testnet, obyteClient) {
	if (typeof pool !== "string" || !isValidAddress(pool))
		throw Error("pool isn't valid")

	if (!poolParams[pool]) {
		const client = obyteClient || getObyteClient(testnet);
		const definition = await client.api.getDefinition(pool);
		const { params } = definition[1];
		poolParams[pool] = params;
	}
	return poolParams[pool];
}

async function getPoolVars(pool, testnet, obyteClient) {
	if (typeof pool !== "string" || !isValidAddress(pool))
		throw Error("pool isn't valid")
	if (cachedPoolVars[pool] && cachedPoolVars[pool].ts > Date.now() - pool_vars_cache_timeout)
		return cachedPoolVars[pool].vars;
	const client = obyteClient || getObyteClient(testnet);
	const vars = await client.api.getAaStateVars({ address: pool, var_prefix: ''});
	cachedPoolVars[pool] = { vars, ts: Date.now() };
	return vars;
}

/**
 * Get the output amount from swapping `in_asset` through `pool`
 * @memberOf counterstake-sdk
 * @param {string} pool
 * @param {number} in_amount_in_pennies
 * @param {string} in_asset
 * @param {boolean} testnet
 * @param {Object} obyteClient
 * @return {Promise<number>}
 * @example
 * const out_amount_in_pennies = await getOswapOutput(pool, in_amount_in_pennies, in_asset, testnet, obyteClient);
 */
async function getOswapOutput(pool, in_amount_in_pennies, in_asset, testnet, obyteClient) {
	const params = await getPoolParams(pool, testnet, obyteClient);
	const stateVars = await getPoolVars(pool, testnet, obyteClient);
	const poolState = getPoolState(params, stateVars);
	const swapParams = getSwapParams(in_amount_in_pennies, in_asset, poolState);
	const { res, delta_Yn } = swapParams;
	const net_amount_out = res.net_amount_X;
	return net_amount_out;
}


exports.findOswapPool = findOswapPool;
exports.getOswapOutput = getOswapOutput;
