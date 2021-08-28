/*jslint node: true */
'use strict';
const { getObyteClient } = require("./obyte-client.js");

const token_registry_address = 'O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ';

let tokenInfos = {};

/**
 * Get information about an Obyte token: symbol, asset id, and decimals
 * @memberOf counterstake-sdk
 * @param {string} symbol_or_asset
 * @param {boolean} testnet
 * @param {Object} obyteClient
 * @return {Promise<Object>}
 * @example
 * const token_info = await getTokenInfo(symbol_or_asset, testnet, obyteClient);
 */
async function getTokenInfo(symbol_or_asset, testnet, obyteClient) {
	if (symbol_or_asset === 'GBYTE' || symbol_or_asset === 'base')
		return { asset: 'base', symbol: 'GBYTE', decimals: 9 };
	if (tokenInfos[symbol_or_asset])
		return tokenInfos[symbol_or_asset];
	const client = obyteClient || getObyteClient(testnet);
	const getAAStateVar = async (address, var_name) => {
		const vars = await client.api.getAaStateVars({ address, var_prefix: var_name });
		return vars[var_name];
	};
	let asset, symbol;
	if (symbol_or_asset.length === 44) {
		asset = symbol_or_asset;
		symbol = await getAAStateVar(token_registry_address, "a2s_" + asset);
		if (!symbol)
			throw Error(`no such asset ` + asset);
	}
	else {
		symbol = symbol_or_asset;
		asset = await getAAStateVar(token_registry_address, "s2a_" + symbol);
		if (!asset)
			throw Error(`no such symbol ` + symbol);
	}
	const desc_hash = await getAAStateVar(token_registry_address, "current_desc_" + asset);
	if (!desc_hash)
		throw Error(`no desc_hash for ` + symbol);
	const decimals = await getAAStateVar(token_registry_address, "decimals_" + desc_hash);
	if (typeof decimals !== 'number')
		throw Error(`no decimals for ` + symbol);
	const info = { asset, symbol, decimals };
	tokenInfos[asset] = info;
	tokenInfos[symbol] = info;
	return info;
}

exports.getTokenInfo = getTokenInfo;
