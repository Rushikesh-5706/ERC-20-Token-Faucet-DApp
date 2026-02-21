import { ethers } from "ethers";
import { TOKEN_ABI, FAUCET_ABI } from "./contracts";

const RPC_URL = import.meta.env.VITE_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS || "";
const FAUCET_ADDRESS = import.meta.env.VITE_FAUCET_ADDRESS || "";

// Multiple fallback RPCs in case one is down
const SEPOLIA_RPCS = [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://sepolia.drpc.org",
    "https://1rpc.io/sepolia",
];

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

    /**
     * Force MetaMask to use our working RPC for Sepolia.
     * wallet_addEthereumChain will update the RPC if the chain already exists.
     * This fixes the Infura rate-limit issue inside MetaMask.
     */
    async _ensureSepoliaRpc() {
        try {
            await window.ethereum.request({
                method: "wallet_addEthereumChain",
                params: [{
                    chainId: "0xaa36a7",
                    chainName: "Sepolia Testnet",
                    nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
                    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
                    blockExplorerUrls: ["https://sepolia.etherscan.io"],
                }],
            });
        } catch {
            // Some wallets don't support this for built-in networks — non-fatal
        }
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

        // Force MetaMask to use our reliable Sepolia RPC instead of rate-limited Infura
        await this._ensureSepoliaRpc();

        // Switch to Sepolia if needed (non-fatal)
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

        // Create signer — wrapped in try/catch for resilience
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            this.signer = await provider.getSigner();
            this.tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, this.signer);
            this.faucetContract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, this.signer);
        } catch {
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

        // Re-apply our RPC to MetaMask right before claiming
        await this._ensureSepoliaRpc();

        // Encode function call (pure computation, zero RPC calls)
        const iface = new ethers.Interface(FAUCET_ABI);
        const data = iface.encodeFunctionData("requestTokens", []);

        // Get account from MetaMask (local, no RPC)
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (!accounts || accounts.length === 0) {
            throw new Error("No accounts connected. Please reconnect your wallet.");
        }

        try {
            // Send transaction DIRECTLY through MetaMask.
            // MetaMask handles nonce, gas price, signing, broadcasting internally.
            const txHash = await window.ethereum.request({
                method: "eth_sendTransaction",
                params: [{
                    from: accounts[0],
                    to: FAUCET_ADDRESS,
                    data: data,
                    gas: "0x30D40", // 200,000 in hex
                }],
            });

            // Wait for receipt using our public read provider (not MetaMask)
            try {
                const readProvider = this.getReadProvider();
                await readProvider.waitForTransaction(txHash, 1, 120000);
            } catch {
                // Receipt wait may fail but tx was sent — fine
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
