/*jslint node: true */
'use strict';
const EventEmitter = require('events');
const { ethers } = require("ethers");
const { isValidAddress } = require('obyte/lib/utils');
const { getSigner, NoMetamaskError } = require("./metamask.js");
const { getObyteClient, watchAA, resumeWatchingAAs } = require("./obyte-client.js");
const { findOswapPool, getOswapOutput } = require("./oswap.js");
const { getTokenInfo } = require("./tokens.js");
const { getBridges, getTransfer } = require("./cs-api");

const { BigNumber, utils: { parseUnits }, constants: { AddressZero } } = ethers;

const FORWARDER_AA = 'QRPI33656RFSEDEZHB5T2DNJ7R2WQQDS'; // double forwarder
  
const counterstakeAbi = [
	"event NewClaim(uint indexed claim_num, address author_address, string sender_address, address recipient_address, string txid, uint32 txts, uint amount, int reward, uint stake, string data, uint32 expiry_ts)"
];
  
const exportAbi = [
	`function transferToForeignChain(string memory foreign_address, string memory data, uint amount, int reward) payable external`
];

const importAbi = [
	`function transferToHomeChain(string memory home_address, string memory data, uint amount, uint reward) external`
];

const erc20Abi = [
	"function allowance(address owner, address spender) public view returns (uint256)",
	"function approve(address spender, uint256 amount) public returns (bool)",
	"function balanceOf(address account) public view returns (uint256)",
];


const csEvents = new EventEmitter();

const getAAPayload = (messages = []) => {
	const dataMessage = messages.find(m => m.app === 'data');
	return dataMessage ? dataMessage.payload : {};
};

function subscribeObyteClient(client) {
	if (client.cs_subscribed)
		return;
	client.subscribe(async (err, result) => {
		if (err) return null;
		const { subject, body } = result[1];
	//	console.log('got', subject, body);
		const { aa_address } = body;
		if (subject === "light/aa_request") {
			const { messages, unit, authors: [{ address }] } = body.unit;
			const payload = getAAPayload(messages);

			// new claim
			if (payload.txid && payload.txts && payload.sender_address) {
				csEvents.emit('NewClaim', { ...payload, claimant_address: address, network: 'Obyte', aa_address, claim_txid: unit, is_request: true });
			}
			else
				console.log(`not a claim in ${unit}`);
		}
		else if (subject === "light/aa_response") {
			const { response, bounced, trigger_unit, trigger_address } = body;
			if (bounced) return null;
			let { responseVars } = response;
			if (!responseVars)
				responseVars = {};
			let { message } = responseVars;
			if (!message)
				message = '';

			// new claim
			if (responseVars.new_claim_num) {
				const resp = await client.api.getJoint(trigger_unit);
				if (!resp)
					throw Error(`failed to get trigger ${trigger_unit}`);
				const { unit: { messages } } = resp.joint;
				const payload = getAAPayload(messages);
				csEvents.emit('NewClaim', { ...payload, claimant_address: trigger_address, network: 'Obyte', aa_address, claim_txid: trigger_unit, claim_num: responseVars.new_claim_num });
			}
			else
				console.log(`not a claim in AA response from ${trigger_unit}`);
		}
	});

	client.onConnect(() => {
		console.log(`connected`);
		client.client.ws.addEventListener("close", () => {
			console.log(`ws closed`);
		});
		resumeWatchingAAs(client);
	});
	
	client.cs_subscribed = true;
}

function toBN(amount, min_decimals, decimals) {
	return parseUnits((+amount).toFixed(min_decimals), decimals);
}

/**
 * Find a bridge that allows to transfer `src_asset` from `src_network` to `dst_network`
 * @memberOf counterstake-sdk
 * @param {string} src_network
 * @param {string} dst_network
 * @param {string} src_asset
 * @param {boolean} testnet
 * @return {Promise<Object>}
 * @example
 * const bridge = await findBridge(src_network, dst_network, src_asset, testnet);
 */
async function findBridge(src_network, dst_network, src_asset, testnet) {
	const bridges = await getBridges(testnet, false); // use cache if available
	for (let { export_aa, import_aa, home_network, foreign_network, home_asset, foreign_asset, home_symbol, foreign_symbol, home_asset_decimals, foreign_asset_decimals, min_expatriation_reward, min_repatriation_reward, max_expatriation_amount, max_repatriation_amount } of bridges) {
		const min_decimals = Math.min(home_asset_decimals, foreign_asset_decimals);
		if (src_network === home_network && dst_network === foreign_network && (src_asset === home_asset || src_asset === home_symbol))
			return {
				src_bridge_aa: export_aa,
				dst_bridge_aa: import_aa,
				type: 'expatriation',
				src_asset: home_asset,
				dst_asset: foreign_asset,
				src_symbol: home_symbol,
				dst_symbol: foreign_symbol,
				src_decimals: home_asset_decimals,
				dst_decimals: foreign_asset_decimals,
				min_decimals,
				min_reward: min_expatriation_reward,
				max_amount: max_expatriation_amount,
			};
		if (src_network === foreign_network && dst_network === home_network && (src_asset === foreign_asset || src_asset === foreign_symbol))
			return {
				src_bridge_aa: import_aa,
				dst_bridge_aa: export_aa,
				type: 'repatriation',
				src_asset: foreign_asset,
				dst_asset: home_asset,
				src_symbol: foreign_symbol,
				dst_symbol: home_symbol,
				src_decimals: foreign_asset_decimals,
				dst_decimals: home_asset_decimals,
				min_decimals,
				min_reward: min_repatriation_reward,
				max_amount: max_repatriation_amount,
			};
	}
	return null;
}


async function approve(tokenAddress, spenderAddress, signer) {
	if (typeof tokenAddress !== "string")
		throw Error(`tokenAddress isn't valid`);
	const sender_address = await signer.getAddress();
	if (tokenAddress === AddressZero)
		throw Error(`don't need to approve ETH`);
	const token = new ethers.Contract(tokenAddress, erc20Abi, signer);
	const allowance = await token.allowance(sender_address, spenderAddress);
	if (allowance.gt(0)) {
		console.log(`spender ${spenderAddress} already approved`);
		return "already approved";
	}
	console.log(`will approve contract ${spenderAddress} to spend my token ${tokenAddress}`);
	const res = await token.approve(spenderAddress, BigNumber.from(2).pow(256).sub(1));
	console.log(`approval tx`, res);
	await res.wait();
	console.log(`approval mined`);
	return res;
}

class NoBridgeError extends Error { }
class NoOswapPoolError extends Error { }
class AmountTooLargeError extends Error { }
class NotValidParamError extends Error { }

/**
 * Send a cross-chain transfer from an EVM based chain to Obyte
 * @memberOf counterstake-sdk
 * @param {Object} transferInfo
 * @return {Promise<string>}
 * @example
 * const txid = await transferEVM2Obyte({
	amount: 100.0,
	src_network: 'Ethereum',
	src_asset: 'USDC',
	dst_network: 'Obyte',
	dst_asset: 'GBYTE',
	recipient_address: 'EJC4A7WQGHEZEKW6RLO7F26SAR4LAQBU',
	assistant_reward_percent: 1.0,
	signer,
	testnet: false,
	obyteClient: client,
});
 */
async function transferEVM2Obyte({ amount, src_network, src_asset, dst_network, dst_asset, recipient_address, data, assistant_reward_percent, signer, testnet, obyteClient }) {
	if (!signer) {
		if (typeof window === 'undefined')
			throw Error(`need a signer`);
		// in browser, we can create a signer ourselves
		signer = await getSigner(src_network, testnet);
	}
	if (data) {
		if (typeof data !== 'object')
			throw Error(`data must be an object`);
		if (Array.isArray(data) && data.length === 0)
			throw Error(`empty array`);
		if (Object.keys(data).length === 0)
			throw Error(`empty object`);
	}
	if (!recipient_address || !isValidAddress(recipient_address))
		throw new NotValidParamError("recipient_address isn't valid");
	const bridge = await findBridge(src_network, dst_network, src_asset, testnet);
	if (!bridge)
		throw new NoBridgeError(`no bridge from ${src_network} to ${dst_network} for ${src_asset}`);
	const { src_bridge_aa, dst_bridge_aa, type, src_decimals, min_decimals, min_reward, max_amount, dst_asset: bridge_dst_asset, dst_symbol: bridge_dst_symbol } = bridge;
	if (+amount > max_amount)
		throw new AmountTooLargeError(`amount too large, assistants can help with only ${max_amount}`);
	if (typeof assistant_reward_percent !== 'number')
		throw new NotValidParamError("assistant_reward_percent isn't valid");
	const reward = assistant_reward_percent/100 * amount + min_reward;
	const bnAmount = toBN(amount, min_decimals, src_decimals);
	const bnReward = toBN(reward, min_decimals, src_decimals);
	const contract = new ethers.Contract(src_bridge_aa, type === 'expatriation' ? exportAbi : importAbi, signer);
	let address;
	let strData;
	if (dst_asset === bridge_dst_asset || dst_asset === bridge_dst_symbol || !dst_asset) {
		address = data ? FORWARDER_AA : recipient_address;
		strData = data ? JSON.stringify({ address1: recipient_address, data1: data }) : '';
	}
	else { // transfer + swap
		if (dst_network !== 'Obyte')
			throw Error(`transfer+swap implemented for Obyte only`);
		const dst_token = await getTokenInfo(dst_asset, testnet, obyteClient);
		const oswap_aa = await findOswapPool(bridge_dst_asset, dst_token.asset, testnet, obyteClient);
		if (!oswap_aa)
			throw new NoOswapPoolError(`found no oswap pool that connects ${bridge_dst_asset} and ${dst_asset}`);
		if (data) {
			address = FORWARDER_AA;
			strData = JSON.stringify({ address1: oswap_aa, data1: { to: FORWARDER_AA }, address2: recipient_address, data2: data });
		}
		else {
			address = FORWARDER_AA;
			strData = JSON.stringify({ address1: oswap_aa, data1: { to: recipient_address } });
		}
	}
	if (dst_network === 'Obyte') {
		const client = obyteClient || getObyteClient(testnet);
		subscribeObyteClient(client);
		watchAA(dst_bridge_aa, client);
	}
	else { // EVM
		const csContract = new ethers.Contract(dst_bridge_aa, counterstakeAbi, signer);
		csContract.on('NewClaim', (claim_num, author_address, sender_address, recipient_address, txid, txts, amount, reward, stake, data, expiry_ts, event) => {
			const claim_txid = event.transactionHash;
			csEvents.emit('NewClaim', { sender_address, address: recipient_address, txid, txts, amount, reward, data, claimant_address: author_address, network: dst_network, aa_address: dst_bridge_aa, claim_txid, claim_num, removed: event.removed });
		});
	}
	let opts = {};
	if (bridge.src_asset === AddressZero)
		opts.value = bnAmount;
	else
		await approve(bridge.src_asset, src_bridge_aa, signer);
	const f = type === 'expatriation' ? contract.transferToForeignChain : contract.transferToHomeChain;
	const res = await f(address, strData, bnAmount, bnReward, opts);
	console.log(res);
	return res.hash;
}

/**
 * Estimate the amount to be received from a cross-chain transfer
 * @memberOf counterstake-sdk
 * @param {Object} transferInfo
 * @return {Promise<number>}
 * @example
 * const amountOut = await estimateOutput({
	amount: 100.0,
	src_network: 'Ethereum',
	src_asset: 'USDC',
	dst_network: 'Obyte',
	dst_asset: 'GBYTE',
	recipient_address: 'EJC4A7WQGHEZEKW6RLO7F26SAR4LAQBU',
	assistant_reward_percent: 1.0,
	testnet: false,
	obyteClient: client,
});
 */
async function estimateOutput({ amount, src_network, src_asset, dst_network, dst_asset, assistant_reward_percent, testnet, obyteClient }) {
	const bridge = await findBridge(src_network, dst_network, src_asset, testnet);
	if (!bridge)
		throw new NoBridgeError(`no bridge from ${src_network} to ${dst_network} for ${src_asset}`);
	const { dst_decimals, min_reward, max_amount, dst_asset: bridge_dst_asset, dst_symbol: bridge_dst_symbol } = bridge;
	if (+amount > max_amount)
		throw new AmountTooLargeError(`amount too large, assistants can help with only ${max_amount}`);
	if (typeof assistant_reward_percent !== 'number')
		throw new NotValidParamError("assistant_reward_percent isn't valid")
	const reward = assistant_reward_percent/100 * amount + min_reward;
	const net_amount = +(amount - reward).toFixed(dst_decimals);
	if (dst_asset === bridge_dst_asset || dst_asset === bridge_dst_symbol || !dst_asset)
		return net_amount;
	// else we need to swap after transferring
	if (dst_network !== 'Obyte')
		throw Error(`transfer+swap implemented for Obyte only`);
	const dst_token = await getTokenInfo(dst_asset, testnet, obyteClient);
	const oswap_aa = await findOswapPool(bridge_dst_asset, dst_token.asset, testnet, obyteClient);
	if (!oswap_aa)
		throw new NoOswapPoolError(`found no oswap pool that connects ${bridge_dst_symbol} and ${dst_asset}`);
	const net_amount_in_pennies = Math.round(net_amount * 10 ** dst_decimals);
	const out_amount_in_pennies = await getOswapOutput(oswap_aa, net_amount_in_pennies, bridge_dst_asset, testnet, obyteClient);
	return +(out_amount_in_pennies / 10 ** dst_token.decimals).toFixed(dst_token.decimals);
}


exports.getBridges = getBridges;
exports.getTransfer = getTransfer;

exports.getObyteClient = getObyteClient;

exports.findOswapPool = findOswapPool;
exports.getOswapOutput = getOswapOutput;

exports.getTokenInfo = getTokenInfo;

exports.findBridge = findBridge;
exports.transferEVM2Obyte = transferEVM2Obyte;
exports.estimateOutput = estimateOutput;
exports.csEvents = csEvents;

exports.errors = { NoMetamaskError, NoBridgeError, NoOswapPoolError, AmountTooLargeError };
