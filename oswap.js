/*jslint node: true */
'use strict';
const crypto = require('crypto');
const { getEnvironment } = require("./environment.js");
const { getObyteClient } = require("./obyte-client.js");


const oswap_factory_aas = {
	testnet: 'PFNAFDKV6HKKFIEB2R2ZE4IAPSDNNIGX',
	mainnet: 'B22543LKSS35Z55ROU4GDN26RT6MDKWU',
};


let poolParams = {};

let cachedPoolsByPair = {};
const pools_by_pair_cache_timeout = 24 * 3600 * 1000; // 24 hours

let cachedPoolBalances = {};
const pool_balances_cache_timeout = 5 * 60 * 1000; // 5 min


function int_number_from_seed(seed) {
	const hash = crypto.createHash("sha256").update(seed.toString(), "utf8").digest("hex");
	const head = hash.substr(0, 16);
	return parseInt(head, 16);
}

/**
 * Find an Oswap pool that connects `from_asset` and `to_asset`
 * @memberOf counterstake-sdk
 * @param {string} from_asset
 * @param {string} to_asset
 * @param {boolean} testnet
 * @param {Object} obyteClient
 * @return {Promise<string>}
 * @example
 * const pool = await findOswapPool(from_asset, to_asset, testnet, obyteClient);
 */
async function findOswapPool(from_asset, to_asset, testnet, obyteClient) {
	const from_index = int_number_from_seed(from_asset);
	const to_index = int_number_from_seed(to_asset);
	const pair = from_index > to_index ? from_asset + '_' + to_asset : to_asset + '_' + from_asset;
	if (cachedPoolsByPair[pair] && cachedPoolsByPair[pair].ts > Date.now() - pools_by_pair_cache_timeout)
		return cachedPoolsByPair[pair].pool;
	const client = obyteClient || getObyteClient(testnet);
	const var_prefix = 'pairs.' + pair + '.pools';
	const vars = await client.api.getAaStateVars({ address: oswap_factory_aas[getEnvironment(testnet)], var_prefix });
	let pools = [];
	for (let var_name in vars) {
		pools.push(vars[var_name]);
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
	if (!poolParams[pool]) {
		const client = obyteClient || getObyteClient(testnet);
		const definition = await client.api.getDefinition(pool);
		const { params } = definition[1];
		poolParams[pool] = params;
	}
	return poolParams[pool];
}

async function getPoolBalances(pool, testnet, obyteClient) {
	if (cachedPoolBalances[pool] && cachedPoolBalances[pool].ts > Date.now() - pool_balances_cache_timeout)
		return cachedPoolBalances[pool].balances;
	const client = obyteClient || getObyteClient(testnet);
	const all_balances = await client.api.getBalances([pool]);
	let balances = {};
	for (let asset in all_balances[pool])
		balances[asset] = all_balances[pool][asset].total;
	cachedPoolBalances[pool] = { balances, ts: Date.now() };
	return balances;
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
	const { asset0, asset1, swap_fee } = await getPoolParams(pool, testnet, obyteClient);
	const fee = swap_fee / 1e11;
	
	if (in_asset !== asset0 && in_asset !== asset1)
		throw Error(`asset ${in_asset} is neither asset0 nor asset1 of pool ${pool}`);
	const out_asset = in_asset === asset0 ? asset1 : asset0;

	const balances = await getPoolBalances(pool, testnet, obyteClient);
	const in_balance = balances[in_asset];
	const out_balance = balances[out_asset];

	const net_in_amount_in_pennies = in_amount_in_pennies * (1 - fee);
	const out_amount_in_pennies = Math.floor(out_balance * net_in_amount_in_pennies / (in_balance + net_in_amount_in_pennies));
	return out_amount_in_pennies;
}


exports.findOswapPool = findOswapPool;
exports.getOswapOutput = getOswapOutput;
