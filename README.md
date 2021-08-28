# Counterstake SDK

This SDK enables you to integrate cross-chain transactions in your dapps. It uses [Counterstake Bridge](https://counterstake.org) for cross-chain transfers and optionally [Oswap.io](https://oswap.io) for swaps.

The SDK works both in browser and in server based apps (bots).


## Install
```sh
npm install counterstake-sdk
```
or
```sh
yarn add counterstake-sdk
```


## Quick start

Here is how you would transfer 100 USDC from Ethereum and receive GBYTE on the Obyte side. Under the hood, USDC-on-Ethereum will be first transferred to Obyte through [Counterstake Bridge](https://counterstake.org), then the receiving AA will swap USDC-on-Obyte to GBYTE-on-Obyte using [Oswap.io](https://oswap.io) and have it sent to the `recipient_address`.

Browser:
```js
import { transferEVM2Obyte, csEvents } from "counterstake-sdk";

const txid = await transferEVM2Obyte({
	amount: 100.0,
	src_network: 'Ethereum',
	src_asset: 'USDC',
	dst_network: 'Obyte',
	dst_asset: 'GBYTE',
	recipient_address: 'EJC4A7WQGHEZEKW6RLO7F26SAR4LAQBU',
	assistant_reward_percent: 1.00,
//	signer, // signer is optional, will automatically use MetaMask
	testnet: false,
});

csEvents.on('NewClaim', claim => {
	console.log('new claim', claim);
	if (claim.txid !== txid)
		return console.log('another claim');
	// else handle claim of my transfer
});
```

Node.js:
```js
const { transferEVM2Obyte, csEvents } = require("counterstake-sdk");
const { ethers } = require("ethers");
require('dotenv').config();

const provider = new ethers.providers.InfuraProvider(process.env.testnet ? "rinkeby" : "homestead", process.env.infura_project_id);
const ethWallet = ethers.Wallet.fromMnemonic(process.env.mnemonic);
const signer = ethWallet.connect(provider);

const txid = await transferEVM2Obyte({
	amount: 0.1,
	src_network: 'Ethereum',
	src_asset: 'USDC',
	dst_network: 'Obyte',
	dst_asset: 'GBYTE',
	recipient_address: 'EJC4A7WQGHEZEKW6RLO7F26SAR4LAQBU',
	assistant_reward_percent: 1.00,
	signer,
	testnet: process.env.testnet,
});

csEvents.on('NewClaim', claim => {
	console.log('new claim', claim);
	if (claim.txid !== txid)
		return console.log('another claim');
	// else handle claim of my transfer
});
```


## Demos

* Browser (React): https://github.com/byteball/getmein, website: https://getmein.ooo
* Node.js: https://github.com/byteball/counterstake-demo-client



## API

The SDK exports the following functions and objects:
```js
import { 
	transferEVM2Obyte,
	estimateOutput,
	csEvents,
	errors,
	getTransfer,
	getBridges,
	getObyteClient,
	findOswapPool,
	getOswapOutput,
	getTokenInfo,
	findBridge,
} from "counterstake-sdk";
```


### `transferEVM2Obyte`
This is the main function of this SDK. It sends a cross-chain transfer from an EVM based chain (Ethereum, BSC, Polygon) to Obyte. 

If the destination coin on Obyte is not the bridged version of the original coin (such as USDC-on-Ethereum to USDC-on-Obyte), the function tries to find an Oswap pool that would convert the bridged coin to the destination coin (such as USDC-on-Obyte to GBYTE). In this case, the cross-chain transfer is sent not to the recipient but to a [forwarder AA](forwarder.oscript), and additional data is sent in the transfer that instructs the AA to swap the received coins to the destination coins and send them to the recipient.
```js
const txid = await transferEVM2Obyte({
	amount: 0.1,
	src_network: 'Ethereum',
	src_asset: 'USDC',
	dst_network: 'Obyte',
	dst_asset: 'GBYTE',
	recipient_address: 'EJC4A7WQGHEZEKW6RLO7F26SAR4LAQBU',
	assistant_reward_percent: 1.00,
	signer,
	testnet: false,
	obyteClient: client,
});
```
The function's only argument is an object with the following fields:
* `amount`: amount in tokens to be transferred, fractional number or string.
* `src_network`: source network where the tokens are to be transferred from: `Ethereum`, `BSC`, or `Polygon`.
* `src_asset`: the token to transfer, its symbol (`ETH`, `USDC`, etc) or token address.
* `dst_network`: destination network where the tokens are to be transferred to: `Obyte`, `Ethereum`, `BSC`, or `Polygon`. Subsequent swaps are supported on Obyte only.
* `dst_asset`: the token to receive on the destination network, its symbol or asset id (or contract address for EVM networks).
* `recipient_address`: address of the recipient on the destination chain.
* `assistant_reward_percent`: percentage of the amount to be paid to an assistant for helping to process the cross-chain transfer.
* `signer`: signer object from [ethers](https://docs.ethers.io) for signing the transfer transaction. It is optional in browser: if missing, the SDK will use MetaMask to create it and ask the user to change the network if necessary.
* `testnet`: whether to use testnet. Optional. If missing, mainnet is assumed.
* `obyteClient`: [obyte.js](https://obytejs.com) client to use for getting data from the Obyte DAG. Optional. Pass it here if you are already using obyte.js in your dapp and want the SDK to reuse the existing connection. If missing, the SDK will create an obyte.js client. If the function is called several times without `obyteClient`, the SDK will create a connection only once and reuse it between calls.

The function returns the transaction hash of the sending transaction. You can use it to track the progress of the transfer using `csEvents`.

The function can throw `NoMetamaskError`, `NoBridgeError`, `AmountTooLargeError`, and `NoOswapPoolError` errors.


### `estimateOutput`
Similar to `transferEVM2Obyte` but this function only estimates the amount to be received. It takes into account the assistant reward, the exchange rate when swapping, the swapping fee, and slippage.
```js
const amountOut = await estimateOutput({
	amount: 0.1,
	src_network: 'Ethereum',
	src_asset: 'USDC',
	dst_network: 'Obyte',
	dst_asset: 'GBYTE',
	recipient_address: 'EJC4A7WQGHEZEKW6RLO7F26SAR4LAQBU',
	assistant_reward_percent: 1.00,
	testnet: false,
	obyteClient: client,
});
```
The function takes the same argument as `transferEVM2Obyte` except there is no `signer`.

The returned amount is a fractional number (in destination tokens).

The function can throw `NoBridgeError`, `AmountTooLargeError`, and `NoOswapPoolError` errors.


### `csEvents`
`csEvents` is an `EventEmitter` used to listen for `NewClaim` events in order to track the progress of the transfer. `NewClaim` is the only event emitted here.
```js
csEvents.on('NewClaim', claim => {
	console.log('new claim', claim);
	if (claim.txid !== txid)
		return console.log('another claim');
	// else update the transfer status and notify the user
});
```
The `claim` object has the following fields:
* `sender_address`: sender's address on the source chain.
* `address`: address of the recipient of the cross-chain transfer. It can be either the recipient's own address if they receive the same coin as they sent (but on another network) or the address of an AA that performs the subsequent swap and sends the proceeds to the final recipient.
* `txid`: transaction hash of the sending transaction. Use it to match the claim with the prior sending transaction.
* `txts`: timestamp of the sending transaction.
* `amount`: sent amount (in pennies, an integer number on Obyte or a BigNumber on EVM).
* `reward`: assistant reward (in pennies, an integer number on Obyte or a BigNumber on EVM).
* `data`: data sent with the transaction, a string.
* `claimant_address`: address of the claimant, usually an assistant.
* `network`: the network where the claim took place, i.e. the destination network.
* `aa_address`: address of the bridge AA (or contract for EVM) that processed the claim.
* `claim_txid`: claim transaction hash.
* `claim_num`: claim number, available for confirmed claims only.
* `is_request`: optional, used on Obyte only. If `true`, indicates that it is only a request and it has not been confirmed yet (it could become bounced).
* `removed`: optional, used on EVM only. If `true`, indicates that the blockchain has been rewritten and this claim has been removed.

On Obyte, you normally receive two `NewClaim` events for each claim: first with `is_request` set to `true` but without `claim_num`, then with `claim_num` but without `is_request` field after the claim has been processed. You might also receive several events with `is_request` if several assistants try to claim the same transfer, however only one will eventually succeed.

On EVM, you normally receive `NewClaim` only once but in case of a reorg, you might get a `removed` event, then a new one.

When you receive an event with `claim_num`, the transfer has been finished and the user has received their tokens.


### `errors`
An object that includes errors that can be thrown by the SDK functions:
```js
errors = {
	NoMetamaskError,
	NoBridgeError,
	NoOswapPoolError,
	AmountTooLargeError
}
```
* `NoMetamaskError`: thrown when MetaMask is not installed in the browser.
* `NoBridgeError`: thrown when there is no bridge that allows to send the source token to the other chain
* `NoOswapPoolError`: thrown when there is no Oswap pool (or it exists but has 0 liquidity) that allows swapping the coin received from the bridge for the destination coin.
* `AmountTooLargeError`: thrown when the amount to be sent is too large and assistants cannot help with it. This SDK doesn't support self-claims.

If any of the functions throws, use `instanceof` to determine the type of the error and handle it:
```js
import { estimateOutput, errors } from "counterstake-sdk";
try {
	const amountOut = await estimateOutput({...});
	...
}
catch (e) {
	if (e instanceof errors.AmountTooLargeError) {
		console.log('amount too large', e);
		// handle this error
	}
}
```


### `getTransfer`
Query the status of a transfer you previously sent.
```js
const transfer = await getTransfer(txid, testnet);
```
The 1st argument is the transfer hash (`txid`), the 2nd optional argument is an indication that we are working on testnet.

Use this function to track the previously sent transfers.

The returned object has the following fields:
* `sender_address`: sender's address on the source chain.
* `dest_address`: address of the recipient of the cross-chain transfer. It can be either the recipient's own address if they receive the same coin as they sent (but on another network) or the address of an AA that performs the subsequent swap and sends the proceeds to the final recipient.
* `txid`: transaction hash of the sending transaction, same as in the request.
* `txts`: timestamp of the sending transaction.
* `amount`: sent amount (in pennies, a string).
* `reward`: assistant reward (in pennies, a string).
* `data`: data sent with the transaction, a string.
* `claimant_address`: address of the claimant, usually an assistant.
* `status`: claim status: `sent`, `mined`, `claimed` (if only a request has been received) or `claim_confirmed`.
* `claim_txid`: claim transaction hash.
* `claim_num`: claim number, available for confirmed claims only.


### `getBridges`
Get the list of all bridges and information about them.
```js
const bridges = await getBridges(testnet, bForceUpdate);
```
The 1st argument is an indication whether we are working on testnet. The 2nd argument, when set to `true`, forces an update from the counterstake.org server, otherwise a cached response will be returned if it is less than 10 minutes old.

Use this function to get the list of bridges and display the choices to the user.

The function returns an array of objects describing each bridge. The objects include the following fields:
* `home_network`: home network: `Obyte`, `Ethereum`, `BSC`, or `Polygon`.
* `home_asset`: home asset id or token contract address.
* `home_asset_decimals`: decimals of the asset on the home network.
* `home_symbol`: asset's symbol on the home network.
* `export_aa`: AA/contract on the home chain used for exporting tokens to the foreign chain.
* `foreign_network`: foreign network: `Obyte`, `Ethereum`, `BSC`, or `Polygon`.
* `foreign_asset`: asset's id or token contract address on the foreign network.
* `foreign_asset_decimals`: decimals of the asset on the foreign network.
* `foreign_symbol`: asset's symbol on the foreign network.
* `stake_asset`: asset id or token contract address of the asset used to back one's claims on the foreign chain, the same asset is used for counterstaking.
* `import_aa`: AA/contract on the foreign chain used for importing tokens from the home chain.
* `min_expatriation_reward`: minimum reward to be paid to an assistant when expatriating the token (home to foreign). A fractional number.
* `min_repatriation_reward`: minimum reward to be paid to an assistant when repatriating the token (foreign to home). A fractional number.
* `count_expatriation_claimants`: the number of assistants recently active on the foreign chain that can help with an expatriation transfer.
* `count_repatriation_claimants`: the number of assistants recently active on the home chain that can help with a repatriation transfer.
* `max_expatriation_amount`: maximum amount assistants can help with when expatriating. A fractional number.
* `max_repatriation_amount`: maximum amount assistants can help with when repatriating. A fractional number.


### `getObyteClient`
Get obyte.js client created by the SDK.
```js
const obyteClient = getObyteClient(testnet);
```
The only argument is an indication whether we are working on testnet.

The function creates an obyte.js client if it hasn't created one yet, and returns it.


### `findBridge`
Find a bridge that allows to transfer `src_asset` from `src_network` to `dst_network`.
```js
const bridge = await findBridge(src_network, dst_network, src_asset, testnet);
```
* `src_network` is the source network such as `Obyte`, `Ethereum`, `BSC`, `Polygon`.
* `dst_network` is the destination network.
* `src_asset` is the symbol or asset id (or token contract address for EVM) of the transferred asset on the source network.
* `testnet` is an indication whether we are working on testnet.

The function returns an object that describes the found bridge, or `null` if no bridge was found. The object has the following fields:
* `src_bridge_aa`: the AA or contract address of the bridge on the source network (export for expatriations, import for repatriations).
* `dst_bridge_aa`: the AA or contract address of the bridge on the destination network (import for expatriations, export for repatriations).
* `type`: type of transfer, `expatriation` (home to foreign) or `repatriation` (foreign to home).
* `src_asset`: id of the asset (or contract address for EVM) on the source chain.
* `dst_asset`: id of the asset (or contract address for EVM) on the destination chain.
* `src_symbol`: token's symbol on the source chain.
* `dst_symbol`: token's symbol on the destination chain.
* `src_decimals`: token's decimals on the source chain.
* `dst_decimals`: token's decimals on the destination chain.
* `min_decimals`: the smaller of the token's decimals on the source and destination chains. Use it for rounding to avoid sending amounts with excessive precision.
* `min_reward`: the minimum assistant's reward (in tokens) that covers its network fees when claiming. A fractional number.
* `max_amount`: the maximum amount of transfer (in tokens) assistants can help with. A fractional number.


### `findOswapPool`
Find an Oswap pool that connects `from_asset` and `to_asset`.
```js
const pool = await findOswapPool(from_asset, to_asset, testnet, obyteClient);
```
* `from_asset` and `to_asset` are asset ids.
* `testnet` is an indication whether we are working on testnet.
* `obyteClient` is an optional obyte.js client. If not passed, the SDK will create its own.

The function returns the address of the Oswap pool AA or returns `null` or `undefined` if none is found.


### `getOswapOutput`
Get the output amount from swapping `in_asset` through `pool`.
```js
const out_amount_in_pennies = await getOswapOutput(pool, in_amount_in_pennies, in_asset, testnet, obyteClient);
```
* `pool` is the address of Oswap pool AA.
* `in_amount_in_pennies` is the input amount in pennies (smallest indivisible units), an integer.
* `in_asset` is the id of the input asset.
* `testnet` is an indication whether we are working on testnet.
* `obyteClient` is an optional obyte.js client. If not passed, the SDK will create its own.

The function returns the output amount in pennies.


### `getTokenInfo`
Get information about an Obyte token: symbol, asset id, and decimals.
```js
const token_info = await getTokenInfo(symbol_or_asset, testnet, obyteClient);
```
* `symbol_or_asset` token's symbol or asset id.
* `testnet` is an indication whether we are working on testnet.
* `obyteClient` is an optional obyte.js client. If not passed, the SDK will create its own.

The function returns an object with the following fields:
* `asset`: asset id
* `symbol`: token's symbol from the decentralized [token registry](https://tokens.ooo).
* `decimals`: number of decimals.
