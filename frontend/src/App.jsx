import { useState, useEffect } from "react";
import { ethers } from "ethers";
import web3Service from "./utils/web3";
import "./App.css";

function App() {
    const [connected, setConnected] = useState(false);
    const [account, setAccount] = useState("");
    const [balance, setBalance] = useState("0");
    const [canClaim, setCanClaim] = useState(false);
    const [remainingAllowance, setRemainingAllowance] = useState("0");
    const [cooldownTime, setCooldownTime] = useState(0);
    const [loading, setLoading] = useState(false);
    const [claiming, setClaiming] = useState(false);
    const [message, setMessage] = useState(null);
    const [contracts, setContracts] = useState({ token: "", faucet: "" });

    useEffect(() => {
        setContracts(web3Service.getContractAddresses());

        web3Service.onAccountsChanged((accounts) => {
            if (accounts.length === 0) {
                handleDisconnect();
            } else {
                setAccount(accounts[0]);
                loadUserData(accounts[0]);
            }
        });

        web3Service.onChainChanged(() => window.location.reload());
    }, []);

    useEffect(() => {
        if (account) {
            loadUserData(account);
            const interval = setInterval(() => loadUserData(account), 10000);
            return () => clearInterval(interval);
        }
    }, [account]);

    useEffect(() => {
        if (cooldownTime > 0) {
            const interval = setInterval(() => {
                setCooldownTime((prev) => {
                    if (prev <= 1) {
                        if (account) loadUserData(account);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [cooldownTime, account]);

    const loadUserData = async (address) => {
        try {
            const [bal, claim, allowance, cooldown] = await Promise.all([
                web3Service.getBalance(address),
                web3Service.canClaim(address),
                web3Service.getRemainingAllowance(address),
                web3Service.getTimeUntilNextClaim(address),
            ]);
            setBalance(bal);
            setCanClaim(claim);
            setRemainingAllowance(allowance);
            setCooldownTime(cooldown);
        } catch (err) {
            console.error("Error loading user data:", err);
        }
    };

    const handleConnect = async () => {
        setLoading(true);
        setMessage(null);
        try {
            if (!web3Service.isWalletAvailable()) {
                setMessage({ type: "error", text: "MetaMask is not installed." });
                return;
            }
            const address = await web3Service.connectWallet();
            setAccount(address);
            setConnected(true);
            setMessage({ type: "success", text: "Wallet connected successfully." });
            await loadUserData(address);
        } catch (err) {
            setMessage({ type: "error", text: err.message || "Failed to connect wallet." });
        } finally {
            setLoading(false);
        }
    };

    const handleDisconnect = () => {
        web3Service.disconnectWallet();
        setConnected(false);
        setAccount("");
        setBalance("0");
        setCanClaim(false);
        setRemainingAllowance("0");
        setCooldownTime(0);
        setMessage(null);
    };

    const handleClaim = async () => {
        if (!canClaim || claiming) return;
        setClaiming(true);
        setMessage(null);
        try {
            const txHash = await web3Service.requestTokens();
            setMessage({
                type: "success",
                text: "Tokens claimed. Transaction: " + txHash.substring(0, 10) + "...",
            });
            await loadUserData(account);
        } catch (err) {
            setMessage({ type: "error", text: err.message || "Failed to claim tokens." });
        } finally {
            setClaiming(false);
        }
    };

    const formatBalance = (bal) => {
        try {
            return parseFloat(ethers.formatEther(bal)).toFixed(2);
        } catch {
            return "0.00";
        }
    };

    const formatAddress = (addr) => {
        if (!addr) return "";
        return addr.substring(0, 6) + "..." + addr.substring(addr.length - 4);
    };

    const formatTime = (seconds) => {
        if (seconds <= 0) return "Ready to claim";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) return h + "h " + m + "m " + s + "s";
        if (m > 0) return m + "m " + s + "s";
        return s + "s";
    };

    return (
        <div className="app">
            <div className="container">
                <header className="header">
                    <h1>ERC-20 Token Faucet</h1>
                    <p>Claim free test tokens on Sepolia testnet</p>
                </header>

                {message && (
                    <div className={"alert alert-" + message.type}>
                        {message.text}
                    </div>
                )}

                <div className="card">
                    <h2>Wallet Connection</h2>
                    {!connected ? (
                        <div className="center-content">
                            <p>Connect your MetaMask wallet to get started.</p>
                            <button className="btn btn-primary" onClick={handleConnect} disabled={loading}>
                                {loading ? "Connecting..." : "Connect MetaMask"}
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="wallet-row">
                                <span className="badge-connected">Connected</span>
                                <span className="address">{formatAddress(account)}</span>
                                <button className="btn btn-secondary" onClick={handleDisconnect}>
                                    Disconnect
                                </button>
                            </div>
                            <div className="stats-grid">
                                <div className="stat-card">
                                    <div className="stat-label">Token Balance</div>
                                    <div className="stat-value">{formatBalance(balance)} FCT</div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-label">Remaining Allowance</div>
                                    <div className="stat-value">
                                        {parseFloat(ethers.formatEther(remainingAllowance || "0")).toFixed(0)} FCT
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {connected && (
                    <div className="card">
                        <h2>Claim Tokens</h2>
                        <div className="claim-info">
                            <div className="stat-label">
                                {canClaim && cooldownTime === 0 ? "Ready to claim" : "Next claim available in"}
                            </div>
                            <div className="cooldown-timer">{formatTime(cooldownTime)}</div>
                            <p>10 FCT per claim — 24-hour cooldown — 100 FCT lifetime maximum</p>
                        </div>
                        <button
                            className="btn btn-primary"
                            onClick={handleClaim}
                            disabled={!canClaim || claiming || cooldownTime > 0}
                        >
                            {claiming
                                ? "Processing..."
                                : cooldownTime > 0
                                    ? "Wait " + formatTime(cooldownTime)
                                    : !canClaim
                                        ? "Cannot Claim"
                                        : "Claim 10 FCT"}
                        </button>
                        {remainingAllowance === "0" && (
                            <div className="alert alert-warning" style={{ marginTop: "1rem" }}>
                                You have reached the maximum lifetime claim limit of 100 FCT.
                            </div>
                        )}
                    </div>
                )}

                <div className="card">
                    <h3>Contract Information</h3>
                    <div className="contract-info">
                        <div>
                            <strong>Token (FCT):</strong>{" "}
                            <a
                                href={"https://sepolia.etherscan.io/address/" + contracts.token}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {contracts.token || "Not configured"}
                            </a>
                        </div>
                        <div>
                            <strong>Faucet:</strong>{" "}
                            <a
                                href={"https://sepolia.etherscan.io/address/" + contracts.faucet}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {contracts.faucet || "Not configured"}
                            </a>
                        </div>
                    </div>
                </div>

                <footer className="footer">
                    <p>Built with React, Ethers.js, and Solidity on Sepolia Testnet</p>
                </footer>
            </div>
        </div>
    );
}

export default App;
