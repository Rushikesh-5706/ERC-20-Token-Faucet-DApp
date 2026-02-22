import { ethers } from "ethers";
import { TOKEN_ABI, FAUCET_ABI } from "./contracts";

const RPC_URL = import.meta.env.VITE_RPC_URL || "";
const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS || "";
const FAUCET_ADDRESS = import.meta.env.VITE_FAUCET_ADDRESS || "";
const CHAIN_ID = import.meta.env.VITE_CHAIN_ID || "11155111";

// Single shared read provider — created once, reused for all read calls.
// staticNetwork: true skips eth_chainId init call on every instantiation.
let _readProvider = null;

function getReadProvider() {
    if (!_readProvider) {
        _readProvider = new ethers.JsonRpcProvider(RPC_URL, parseInt(CHAIN_ID), {
            staticNetwork: true,
        });
    }
    return _readProvider;
}

class Web3Service {
    constructor() {
        this.currentAccount = null;
    }

    isWalletAvailable() {
        return typeof window !== "undefined" && typeof window.ethereum !== "undefined";
    }

    async connectWallet() {
        if (!this.isWalletAvailable()) {
            throw new Error("No wallet detected. Please install MetaMask.");
        }

        const accounts = await window.ethereum.request({
            method: "eth_requestAccounts",
        });

        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts found. Please unlock your wallet.");
        }

        this.currentAccount = accounts[0];

        // Fix MetaMask's broken Sepolia RPC by adding our Alchemy endpoint
        try {
            await window.ethereum.request({
                method: "wallet_addEthereumChain",
                params: [{
                    chainId: "0xaa36a7",
                    chainName: "Sepolia",
                    nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
                    rpcUrls: [RPC_URL],
                    blockExplorerUrls: ["https://sepolia.etherscan.io"],
                }],
            });
        } catch {
            // Non-fatal — some wallets don't allow overriding built-in networks
        }

        // Chain check — eth_chainId is local to MetaMask, no RPC needed
        try {
            const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
            const chainId = parseInt(chainIdHex, 16);
            if (chainId !== 11155111 && chainId !== 31337) {
                await window.ethereum.request({
                    method: "wallet_switchEthereumChain",
                    params: [{ chainId: "0xaa36a7" }],
                });
            }
        } catch {
            // Non-fatal
        }

        // NO BrowserProvider / getSigner — it triggers eth_blockNumber through
        // MetaMask which fails with "Failed to fetch" when MetaMask's RPC is broken.
        // requestTokens() uses raw window.ethereum.request instead.

        return this.currentAccount;
    }

    async ensureSignerReady() {
        if (this.currentAccount) return;
        if (this.isWalletAvailable()) {
            await this.connectWallet();
        } else {
            throw new Error("Wallet not available.");
        }
    }

    disconnectWallet() {
        this.currentAccount = null;
    }

    // ── Read functions — all use the shared Alchemy provider ─────────────────

    async getBalance(address) {
        try {
            const contract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, getReadProvider());
            const balance = await contract.balanceOf(address);
            return balance.toString();
        } catch (err) {
            console.error("getBalance error:", err.message);
            return "0";
        }
    }

    async canClaim(address) {
        try {
            const contract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, getReadProvider());
            return await contract.canClaim(address);
        } catch (err) {
            console.error("canClaim error:", err.message);
            return false;
        }
    }

    async getRemainingAllowance(address) {
        try {
            const contract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, getReadProvider());
            const allowance = await contract.remainingAllowance(address);
            return allowance.toString();
        } catch (err) {
            console.error("getRemainingAllowance error:", err.message);
            return "0";
        }
    }

    async getTimeUntilNextClaim(address) {
        try {
            const contract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, getReadProvider());
            const t = await contract.timeUntilNextClaim(address);
            return Number(t);
        } catch {
            return 0;
        }
    }

    // ── Write: raw eth_sendTransaction — bypasses MetaMask's broken RPC ──────

    async requestTokens() {
        if (!this.isWalletAvailable()) {
            throw new Error("Wallet not available.");
        }

        // Get account — local to MetaMask, no RPC
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts connected. Please reconnect your wallet.");
        }
        const from = accounts[0];

        // Encode function call — pure computation, zero RPC
        const iface = new ethers.Interface(FAUCET_ABI);
        const data = iface.encodeFunctionData("requestTokens", []);

        // Get nonce + fee data from our Alchemy RPC (not MetaMask)
        const provider = getReadProvider();
        const [nonce, feeData] = await Promise.all([
            provider.getTransactionCount(from, "pending"),
            provider.getFeeData(),
        ]);

        // Build fully-specified EIP-1559 transaction
        const txParams = {
            from: from,
            to: FAUCET_ADDRESS,
            data: data,
            gas: "0x30D40", // 200,000
            nonce: "0x" + nonce.toString(16),
            value: "0x0",
            chainId: "0xaa36a7",
        };

        if (feeData.maxFeePerGas) {
            txParams.maxFeePerGas = "0x" + feeData.maxFeePerGas.toString(16);
            txParams.maxPriorityFeePerGas = "0x" + (feeData.maxPriorityFeePerGas || 1000000000n).toString(16);
            txParams.type = "0x2";
        } else if (feeData.gasPrice) {
            txParams.gasPrice = "0x" + feeData.gasPrice.toString(16);
        }

        try {
            // Send directly to MetaMask — it only needs to sign + broadcast
            const txHash = await window.ethereum.request({
                method: "eth_sendTransaction",
                params: [txParams],
            });

            // Wait for receipt via our Alchemy RPC
            try {
                await provider.waitForTransaction(txHash, 1, 120000);
            } catch {
                // Tx sent successfully, receipt wait is non-fatal
            }

            return txHash;
        } catch (error) {
            const msg = error?.message || error?.data?.message || "";
            if (msg.includes("Faucet is paused")) throw new Error("The faucet is currently paused.");
            if (msg.includes("Cooldown period not elapsed")) throw new Error("You must wait 24 hours between claims.");
            if (msg.includes("Lifetime claim limit reached")) throw new Error("You have reached the maximum lifetime claim limit.");
            if (msg.includes("user rejected") || msg.includes("User denied") || msg.includes("denied")) throw new Error("Transaction was rejected.");
            throw new Error("Claim failed: " + msg);
        }
    }

    getContractAddresses() {
        return { token: TOKEN_ADDRESS, faucet: FAUCET_ADDRESS };
    }

    onAccountsChanged(callback) {
        if (this.isWalletAvailable()) window.ethereum.on("accountsChanged", callback);
    }

    onChainChanged(callback) {
        if (this.isWalletAvailable()) window.ethereum.on("chainChanged", callback);
    }
}

const web3Service = new Web3Service();
export default web3Service;
