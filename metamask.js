/*jslint node: true */
'use strict';
const { ethers } = require("ethers");
const { getEnvironment } = require("./environment.js");


const chainIds = {
	mainnet: {
		Ethereum: 1,
		BSC: 56,
		Polygon: 137
	},
	testnet: {
		Ethereum: 4, // rinkeby
		BSC: 97,
		Polygon: 80001
	},
};

const rpcMeta = {
	mainnet: {
		Ethereum: undefined,
		BSC: {
			chainId: '0x38',
			chainName: 'BSC Network',
			nativeCurrency:
			{
				name: 'BNB',
				symbol: 'BNB',
				decimals: 18
			},
			rpcUrls: ['https://bsc-dataseed.binance.org/'],
			blockExplorerUrls: ['https://bscscan.com/'],
		},
		Polygon: {
			chainId: '0x89',
			chainName: 'Polygon Network',
			nativeCurrency:
			{
				name: 'MATIC',
				symbol: 'MATIC',
				decimals: 18
			},
			rpcUrls: ['https://rpc-mainnet.maticvigil.com'],
			blockExplorerUrls: ['https://polygonscan.com/'],
		}
	},
	testnet: {
		Ethereum: undefined, // rinkeby
		BSC: {
			chainId: '0x61',
			chainName: 'BSC Test Network',
			nativeCurrency:
			{
				name: 'BNB',
				symbol: 'BNB',
				decimals: 18
			},
			rpcUrls: ['https://data-seed-prebsc-1-s1.binance.org:8545'],
			blockExplorerUrls: ['https://testnet.bscscan.com/'],
		},
		Polygon: {
			chainId: '0x13881',
			chainName: 'Polygon TEST Network',
			nativeCurrency:
			{
				name: 'MATIC',
				symbol: 'MATIC',
				decimals: 18
			},
			rpcUrls: ['https://rpc-mumbai.maticvigil.com'],
			blockExplorerUrls: ['https://mumbai.polygonscan.com/'],
		}
	},
};

class NoMetamaskError extends Error { }

async function loginEthereum() {
	await window.ethereum.request({ method: 'eth_requestAccounts' });
}

async function changeNetwork(network, testnet) {
	const environment = getEnvironment(testnet);
	const chainId = chainIds[environment][network];
	return await window.ethereum.request({
		method: 'wallet_switchEthereumChain',
		params: [{ chainId: `0x${Number(chainId).toString(16)}` }],
	}).catch(async (switchError) => {
		if (switchError.code === 4902) {
			const params = rpcMeta[environment][network];

			await window.ethereum.request({
				method: 'wallet_addEthereumChain',
				params: [params],
			});

			await window.ethereum.request({
				method: 'wallet_switchEthereumChain',
				params: [{ chainId: `0x${Number(chainId).toString(16)}` }],
			}).catch((e) => {
				throw new Error("wallet_switchEthereumChain error", e);
			})

			return Promise.resolve()
		} else {
			throw new Error("wallet_switchEthereumChain error");
		}
	});
}

async function getProvider(network, testnet) {
	if (!window.ethereum)
		throw new NoMetamaskError("MetaMask not found");
	await loginEthereum();

	let provider = new ethers.providers.Web3Provider(window.ethereum);
	const requiredChainId = chainIds[getEnvironment(testnet)][network];
	const chainId = (await provider.getNetwork()).chainId;
	if (!chainId || chainId !== requiredChainId) {
		await changeNetwork(network, testnet)
		provider = new ethers.providers.Web3Provider(window.ethereum);
	}
	return provider;
}

async function getSigner(network, testnet) {
	const provider = await getProvider(network, testnet);
	const signer = provider.getSigner();
	return signer;
}


exports.NoMetamaskError = NoMetamaskError;
exports.getProvider = getProvider;
exports.getSigner = getSigner;
