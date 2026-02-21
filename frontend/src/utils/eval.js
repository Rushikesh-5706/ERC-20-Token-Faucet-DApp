import web3Service from "./web3.js";

window.__EVAL__ = {
    connectWallet: async () => {
        try {
            const address = await web3Service.connectWallet();
            if (!address) throw new Error("No address returned from connectWallet");
            return String(address);
        } catch (err) {
            throw new Error("connectWallet failed: " + err.message);
        }
    },

    requestTokens: async () => {
        try {
            const txHash = await web3Service.requestTokens();
            if (!txHash) throw new Error("No transaction hash returned");
            return String(txHash);
        } catch (err) {
            throw new Error("requestTokens failed: " + err.message);
        }
    },

    getBalance: async (address) => {
        try {
            if (!address) throw new Error("address parameter is required");
            const balance = await web3Service.getBalance(String(address));
            return String(balance);
        } catch (err) {
            throw new Error("getBalance failed: " + err.message);
        }
    },

    canClaim: async (address) => {
        try {
            if (!address) throw new Error("address parameter is required");
            const result = await web3Service.canClaim(String(address));
            return Boolean(result);
        } catch (err) {
            throw new Error("canClaim failed: " + err.message);
        }
    },

    getRemainingAllowance: async (address) => {
        try {
            if (!address) throw new Error("address parameter is required");
            const allowance = await web3Service.getRemainingAllowance(String(address));
            return String(allowance);
        } catch (err) {
            throw new Error("getRemainingAllowance failed: " + err.message);
        }
    },

    getContractAddresses: async () => {
        return {
            token: import.meta.env.VITE_TOKEN_ADDRESS || "",
            faucet: import.meta.env.VITE_FAUCET_ADDRESS || "",
        };
    },
};
