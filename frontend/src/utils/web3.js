import { ethers } from "ethers";
import { TOKEN_ABI, FAUCET_ABI } from "./contracts";

const RPC_URL = import.meta.env.VITE_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS || "";
const FAUCET_ADDRESS = import.meta.env.VITE_FAUCET_ADDRESS || "";

// ── SINGLE shared read provider ─────────────────────────────────────────────
// staticNetwork: true tells ethers.js "I know the network; skip eth_chainId
// and eth_blockNumber detection calls". This eliminates 2-3 RPC calls per
// provider creation that were causing publicnode.com to rate-limit us.
const sepoliaNetwork = new ethers.Network("sepolia", 11155111);
const readProvider = new ethers.JsonRpcProvider(RPC_URL, sepoliaNetwork, {
    staticNetwork: true,
    batchMaxCount: 1, // Disable batching to avoid large payloads
});

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

        // Chain check — eth_chainId is local to MetaMask, no RPC
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

    // ── Read functions — all use the single shared provider ─────────────────

    async getBalance(address) {
        const contract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, readProvider);
        const balance = await contract.balanceOf(address);
        return balance.toString();
    }

    async canClaim(address) {
        const contract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, readProvider);
        return await contract.canClaim(address);
    }

    async getRemainingAllowance(address) {
        const contract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, readProvider);
        const allowance = await contract.remainingAllowance(address);
        return allowance.toString();
    }

    async getTimeUntilNextClaim(address) {
        try {
            const contract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, readProvider);
            const t = await contract.timeUntilNextClaim(address);
            return Number(t);
        } catch {
            return 0;
        }
    }

    // ── Write function ──────────────────────────────────────────────────────

    async requestTokens() {
        if (!this.isWalletAvailable()) {
            throw new Error("Wallet not available.");
        }

        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts connected. Please reconnect your wallet.");
        }
        const from = accounts[0];

        // Encode function call — pure computation, zero RPC
        const iface = new ethers.Interface(FAUCET_ABI);
        const data = iface.encodeFunctionData("requestTokens", []);

        // Get nonce + fees from our RPC with retry
        let nonce, feeData;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                [nonce, feeData] = await Promise.all([
                    readProvider.getTransactionCount(from, "pending"),
                    readProvider.getFeeData(),
                ]);
                break; // success
            } catch {
                if (attempt === 2) {
                    throw new Error("Network busy. Please wait 30 seconds and try again.");
                }
                // Wait before retry (5s, then 10s)
                await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
            }
        }

        // Build fully-specified tx
        const txParams = {
            from: from,
            to: FAUCET_ADDRESS,
            data: data,
            gas: "0x30D40",
            nonce: "0x" + nonce.toString(16),
            value: "0x0",
        };

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

            // Wait for receipt via our RPC
            try {
                await readProvider.waitForTransaction(txHash, 1, 120000);
            } catch {
                // Tx sent, receipt wait timeout is non-fatal
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
