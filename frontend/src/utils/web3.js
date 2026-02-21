import { ethers } from "ethers";
import { TOKEN_ABI, FAUCET_ABI } from "./contracts";

const RPC_URL = import.meta.env.VITE_RPC_URL || "";
const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS || "";
const FAUCET_ADDRESS = import.meta.env.VITE_FAUCET_ADDRESS || "";

class Web3Service {
    constructor() {
        this.signer = null;
        this.tokenContract = null;
        this.faucetContract = null;
        this.currentAccount = null;
    }

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

        const accounts = await window.ethereum.request({
            method: "eth_requestAccounts",
        });

        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts found. Please unlock your wallet.");
        }

        this.currentAccount = accounts[0];

        // Use raw ethereum request for chain ID check — served locally by MetaMask,
        // no RPC call needed (unlike provider.getNetwork which calls eth_blockNumber).
        try {
            const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
            const chainId = parseInt(chainIdHex, 16);
            if (chainId !== 11155111 && chainId !== 31337) {
                await window.ethereum.request({
                    method: "wallet_switchEthereumChain",
                    params: [{ chainId: "0xaa36a7" }], // Sepolia
                });
            }
        } catch {
            // Non-fatal: continue with whatever network is connected
        }

        // Create signer for backward compatibility (eval interface uses it).
        // Wrapped in try-catch so connectWallet still succeeds even if
        // BrowserProvider hits rate limits — requestTokens doesn't need it.
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            this.signer = await provider.getSigner();
            this.tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, this.signer);
            this.faucetContract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, this.signer);
        } catch {
            // Signer creation failed due to RPC rate limit — requestTokens
            // uses window.ethereum.request directly, so it will still work.
            this.signer = null;
            this.tokenContract = null;
            this.faucetContract = null;
        }

        return this.currentAccount;
    }

    async ensureSignerReady() {
        if (this.signer && this.faucetContract) return;
        if (this.isWalletAvailable()) {
            await this.connectWallet();
        } else {
            throw new Error("Wallet not available.");
        }
    }

    disconnectWallet() {
        this.signer = null;
        this.tokenContract = null;
        this.faucetContract = null;
        this.currentAccount = null;
    }

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

    async requestTokens() {
        if (!this.isWalletAvailable()) {
            throw new Error("Wallet not available.");
        }

        // Encode the function call data using ethers Interface (pure computation, no RPC).
        const iface = new ethers.Interface(FAUCET_ABI);
        const data = iface.encodeFunctionData("requestTokens", []);

        // Get current account directly from MetaMask — this is local, no RPC call.
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts connected. Please reconnect your wallet.");
        }

        try {
            // Send transaction DIRECTLY through MetaMask using raw ethereum request.
            // This completely bypasses ethers.js BrowserProvider and avoids
            // eth_blockNumber / eth_estimateGas calls that were being rate-limited
            // by MetaMask's internal Infura RPC.
            // MetaMask internally handles: nonce, gas price, signing, broadcasting.
            const txHash = await window.ethereum.request({
                method: "eth_sendTransaction",
                params: [{
                    from: accounts[0],
                    to: FAUCET_ADDRESS,
                    data: data,
                    gas: "0x30D40", // 200,000 in hex — more than enough for requestTokens()
                }],
            });

            // Wait for the receipt using our PUBLIC read provider (publicnode.com),
            // NOT MetaMask's rate-limited Infura.
            try {
                const readProvider = this.getReadProvider();
                await readProvider.waitForTransaction(txHash, 1, 120000);
            } catch {
                // Receipt wait failed but tx was still sent successfully
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
