import { ethers } from "ethers";
import { TOKEN_ABI, FAUCET_ABI } from "./contracts";

const RPC_URL = import.meta.env.VITE_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS || "";
const FAUCET_ADDRESS = import.meta.env.VITE_FAUCET_ADDRESS || "";

class Web3Service {
    constructor() {
        this.currentAccount = null;
    }

    // Our own reliable RPC — never touches MetaMask
    getReadProvider() {
        return new ethers.JsonRpcProvider(RPC_URL);
    }

    isWalletAvailable() {
        return typeof window !== "undefined" && typeof window.ethereum !== "undefined";
    }

    async connectWallet() {
        if (!this.isWalletAvailable()) {
            throw new Error("No wallet detected. Please install MetaMask.");
        }

        // eth_requestAccounts — handled locally by MetaMask, no RPC call
        const accounts = await window.ethereum.request({
            method: "eth_requestAccounts",
        });

        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts found. Please unlock your wallet.");
        }

        this.currentAccount = accounts[0];

        // eth_chainId — served locally by MetaMask, no RPC to Infura
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

        // NO BrowserProvider, NO getSigner() — these trigger eth_blockNumber
        // through MetaMask's Infura which poisons the rate limiter.
        // requestTokens() uses window.ethereum.request() directly instead.

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

    // ── Read functions — use our own RPC, never MetaMask ─────────────────────

    async getBalance(address) {
        const contract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, this.getReadProvider());
        const balance = await contract.balanceOf(address);
        return balance.toString();
    }

    async canClaim(address) {
        const contract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, this.getReadProvider());
        return await contract.canClaim(address);
    }

    async getRemainingAllowance(address) {
        const contract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, this.getReadProvider());
        const allowance = await contract.remainingAllowance(address);
        return allowance.toString();
    }

    async getTimeUntilNextClaim(address) {
        try {
            const contract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, this.getReadProvider());
            const t = await contract.timeUntilNextClaim(address);
            return Number(t);
        } catch {
            return 0;
        }
    }

    // ── Write function — pre-populate ALL tx params from our RPC ─────────────

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

        // Get nonce + fee data from OUR RPC (publicnode.com) — not MetaMask's Infura
        const rpcProvider = this.getReadProvider();
        const [nonce, feeData] = await Promise.all([
            rpcProvider.getTransactionCount(from, "pending"),
            rpcProvider.getFeeData(),
        ]);

        // Build a FULLY-SPECIFIED transaction so MetaMask doesn't need to query anything.
        // MetaMask only needs to: show popup → sign → broadcast.
        const txParams = {
            from: from,
            to: FAUCET_ADDRESS,
            data: data,
            gas: "0x30D40", // 200,000
            nonce: "0x" + nonce.toString(16),
            value: "0x0",
        };

        // Use EIP-1559 if fee data available, otherwise legacy gasPrice
        if (feeData.maxFeePerGas) {
            txParams.maxFeePerGas = "0x" + feeData.maxFeePerGas.toString(16);
            txParams.maxPriorityFeePerGas = "0x" + (feeData.maxPriorityFeePerGas || 1000000000n).toString(16);
            txParams.type = "0x2";
        } else if (feeData.gasPrice) {
            txParams.gasPrice = "0x" + feeData.gasPrice.toString(16);
        }

        try {
            const txHash = await window.ethereum.request({
                method: "eth_sendTransaction",
                params: [txParams],
            });

            // Wait for receipt via our own RPC (not MetaMask)
            try {
                await rpcProvider.waitForTransaction(txHash, 1, 120000);
            } catch {
                // Tx was sent, receipt wait timeout is non-fatal
            }

            return txHash;
        } catch (error) {
            const msg = error?.message || error?.data?.message || "";
            if (msg.includes("Faucet is paused")) throw new Error("The faucet is currently paused.");
            if (msg.includes("Cooldown period not elapsed")) throw new Error("You must wait 24 hours between claims.");
            if (msg.includes("Lifetime claim limit reached")) throw new Error("You have reached the maximum lifetime claim limit.");
            if (msg.includes("user rejected") || msg.includes("User denied") || msg.includes("denied")) throw new Error("Transaction was rejected.");
            throw new Error("Token claim failed: " + msg);
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
