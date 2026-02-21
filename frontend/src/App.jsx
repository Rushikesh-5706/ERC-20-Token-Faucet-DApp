import { useState, useEffect } from "react";
import { ethers } from "ethers";
import web3Service from "./utils/web3";
import "./App.css";

// ── Icon components (inline SVG — no dependencies needed) ───────────────────

function IconWallet() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 12V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h13a2 2 0 002-2v-4" />
            <path d="M16 12h4v4h-4z" />
            <circle cx="18" cy="14" r=".5" fill="currentColor" />
        </svg>
    );
}

function IconCheck() {
    return (
        <svg className="alert-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8l3 3 7-7" />
        </svg>
    );
}

function IconX() {
    return (
        <svg className="alert-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
    );
}

function IconWarn() {
    return (
        <svg className="alert-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2l6 12H2L8 2z" />
            <path d="M8 7v3M8 11.5v.5" />
        </svg>
    );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function shortAddr(addr) {
    if (!addr) return "";
    return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function fmtFCT(raw) {
    try {
        return parseFloat(ethers.formatEther(raw)).toFixed(2);
    } catch {
        return "0.00";
    }
}

function fmtFCTInt(raw) {
    try {
        return parseFloat(ethers.formatEther(raw)).toFixed(0);
    } catch {
        return "0";
    }
}

function fmtTime(sec) {
    if (!sec || sec <= 0) return null;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    if (h > 0) return pad(h) + ":" + pad(m) + ":" + pad(s);
    return pad(m) + ":" + pad(s);
}

// Percentage of lifetime allowance remaining (0–100)
function allowancePct(raw) {
    try {
        const remaining = parseFloat(ethers.formatEther(raw));
        return Math.min(100, Math.max(0, (remaining / 100) * 100));
    } catch {
        return 100;
    }
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
    const [connected, setConnected] = useState(false);
    const [account, setAccount] = useState("");
    const [balance, setBalance] = useState("0");
    const [eligibleToClaim, setEligibleToClaim] = useState(false);
    const [remainingAllowance, setRemainingAllowance] = useState("0");
    const [cooldown, setCooldown] = useState(0);
    const [loading, setLoading] = useState(false);
    const [claiming, setClaiming] = useState(false);
    const [msg, setMsg] = useState(null); // { type: 'success'|'error'|'warning', text: '' }
    const [contracts, setContracts] = useState({ token: "", faucet: "" });

    // ── Init ────────────────────────────────────────────────────────────────────

    useEffect(() => {
        setContracts(web3Service.getContractAddresses());

        web3Service.onAccountsChanged((accounts) => {
            if (!accounts || accounts.length === 0) {
                disconnect();
            } else {
                setAccount(accounts[0]);
                fetchData(accounts[0]);
            }
        });

        web3Service.onChainChanged(() => window.location.reload());
    }, []);

    // Polling refresh when connected
    useEffect(() => {
        if (!account) return;
        fetchData(account);
        const id = setInterval(() => fetchData(account), 10000);
        return () => clearInterval(id);
    }, [account]);

    // Countdown tick
    useEffect(() => {
        if (cooldown <= 0) return;
        const id = setInterval(() => {
            setCooldown((prev) => {
                if (prev <= 1) {
                    if (account) fetchData(account);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(id);
    }, [cooldown, account]);

    // ── Data fetch ──────────────────────────────────────────────────────────────

    async function fetchData(addr) {
        try {
            const [bal, canClaim, allowance, timeLeft] = await Promise.all([
                web3Service.getBalance(addr),
                web3Service.canClaim(addr),
                web3Service.getRemainingAllowance(addr),
                web3Service.getTimeUntilNextClaim(addr),
            ]);
            setBalance(bal);
            setEligibleToClaim(canClaim);
            setRemainingAllowance(allowance);
            setCooldown(timeLeft);
        } catch (err) {
            console.error("fetchData error:", err);
        }
    }

    // ── Actions ─────────────────────────────────────────────────────────────────

    async function connect() {
        setLoading(true);
        setMsg(null);
        try {
            if (!web3Service.isWalletAvailable()) {
                setMsg({ type: "error", text: "MetaMask not detected. Please install the extension and refresh." });
                return;
            }
            const addr = await web3Service.connectWallet();
            setAccount(addr);
            setConnected(true);
            await fetchData(addr);
        } catch (err) {
            setMsg({ type: "error", text: err.message || "Wallet connection failed." });
        } finally {
            setLoading(false);
        }
    }

    function disconnect() {
        web3Service.disconnectWallet();
        setConnected(false);
        setAccount("");
        setBalance("0");
        setEligibleToClaim(false);
        setRemainingAllowance("0");
        setCooldown(0);
        setMsg(null);
    }

    async function claim() {
        if (!eligibleToClaim || claiming) return;
        setClaiming(true);
        setMsg(null);
        try {
            const txHash = await web3Service.requestTokens();
            setMsg({
                type: "success",
                text: "10 FCT received. Tx: " + txHash.slice(0, 12) + "...",
            });
            await fetchData(account);
        } catch (err) {
            setMsg({ type: "error", text: err.message || "Claim failed." });
        } finally {
            setClaiming(false);
        }
    }

    // ── Derived state ───────────────────────────────────────────────────────────

    const lifetimeExhausted = remainingAllowance === "0" || remainingAllowance === "0";
    const isReady = eligibleToClaim && cooldown === 0 && !lifetimeExhausted;
    const isWaiting = cooldown > 0;
    const pct = allowancePct(remainingAllowance);
    const timerStr = fmtTime(cooldown);

    // ── Render ───────────────────────────────────────────────────────────────────

    return (
        <div className="layout">

            {/* Topbar */}
            <header className="topbar">
                <div className="topbar-brand">
                    <div className="brand-mark">
                        <svg viewBox="0 0 20 20" fill="white">
                            <path d="M10 2C5.58 2 2 5.58 2 10s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 3c.83 0 1.5.67 1.5 1.5S10.83 8 10 8s-1.5-.67-1.5-1.5S9.17 5 10 5zm0 10c-2.08 0-3.91-1.06-5-2.66.02-1.66 3.33-2.57 5-2.57s4.98.91 5 2.57C13.91 13.94 12.08 15 10 15z" />
                        </svg>
                    </div>
                    <span className="brand-name">FCT / Faucet</span>
                </div>
                <div className="topbar-network">
                    <span className="network-dot" />
                    Sepolia
                </div>
            </header>

            {/* Main */}
            <main className="main">

                <div className="page-title">
                    <h1>Token Faucet</h1>
                    <p>Claim 10 FCT every 24 hours — up to 100 FCT per address</p>
                </div>

                {/* Alert */}
                {msg && (
                    <div className={"alert alert-" + msg.type}>
                        {msg.type === "success" && <IconCheck />}
                        {msg.type === "error" && <IconX />}
                        {msg.type === "warning" && <IconWarn />}
                        <span>{msg.text}</span>
                    </div>
                )}

                {/* Wallet panel */}
                <div className="panel">
                    <div className="panel-header">
                        <span className="panel-label">Wallet</span>
                        {connected && (
                            <button className="btn btn-outline" onClick={disconnect}>
                                Disconnect
                            </button>
                        )}
                    </div>
                    <div className="panel-body">
                        {!connected ? (
                            <div className="connect-prompt">
                                <div className="connect-icon">
                                    <IconWallet />
                                </div>
                                <h2>Connect your wallet</h2>
                                <p>You need MetaMask to claim tokens from this faucet.</p>
                                <button className="btn btn-primary" onClick={connect} disabled={loading}>
                                    {loading ? (
                                        <>
                                            <span className="spinner" />
                                            Connecting...
                                        </>
                                    ) : (
                                        "Connect MetaMask"
                                    )}
                                </button>
                            </div>
                        ) : (
                            <div className="wallet-connected">
                                <div className="wallet-info-left">
                                    <div className="wallet-avatar" />
                                    <div className="wallet-meta">
                                        <span className="wallet-status-label">Connected address</span>
                                        <span className="wallet-addr">{shortAddr(account)}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Balances — only when connected */}
                {connected && (
                    <>
                        <div className="stats-row">
                            <div className="stat-box">
                                <div className="stat-box-label">Token Balance</div>
                                <div className="stat-box-value">
                                    {fmtFCT(balance)}
                                    <span className="stat-box-unit">FCT</span>
                                </div>
                            </div>
                            <div className="stat-box">
                                <div className="stat-box-label">Lifetime Remaining</div>
                                <div className="stat-box-value">
                                    {fmtFCTInt(remainingAllowance)}
                                    <span className="stat-box-unit">/ 100 FCT</span>
                                </div>
                                <div className="allowance-bar-wrap">
                                    <div className="allowance-bar-track">
                                        <div className="allowance-bar-fill" style={{ width: pct + "%" }} />
                                    </div>
                                    <div className="allowance-bar-labels">
                                        <span>claimed</span>
                                        <span>{(100 - pct).toFixed(0)}%</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Claim panel */}
                        <div className="panel">
                            <div className="claim-status-row">
                                <div className="claim-status-left">
                                    {isReady && (
                                        <>
                                            <span className="claim-status-tag ready">
                                                <span className="dot" /> Ready
                                            </span>
                                            <span className="claim-desc">Your 24-hour cooldown has elapsed.</span>
                                        </>
                                    )}
                                    {isWaiting && (
                                        <>
                                            <span className="claim-status-tag waiting">
                                                <span className="dot" /> Cooldown
                                            </span>
                                            <span className="claim-desc">Next claim available after timer ends.</span>
                                        </>
                                    )}
                                    {lifetimeExhausted && (
                                        <>
                                            <span className="claim-status-tag exhausted">
                                                <span className="dot" /> Limit Reached
                                            </span>
                                            <span className="claim-desc">Maximum 100 FCT per address has been claimed.</span>
                                        </>
                                    )}
                                </div>
                                {isWaiting && timerStr && (
                                    <div className="timer-display">{timerStr}</div>
                                )}
                            </div>

                            <div className="claim-action">
                                <button
                                    className="btn btn-primary"
                                    onClick={claim}
                                    disabled={!isReady || claiming}
                                >
                                    {claiming ? (
                                        <>
                                            <span className="spinner" />
                                            Sending transaction...
                                        </>
                                    ) : isWaiting ? (
                                        "Waiting for cooldown"
                                    ) : lifetimeExhausted ? (
                                        "Limit reached"
                                    ) : (
                                        "Claim 10 FCT"
                                    )}
                                </button>
                                {isReady && (
                                    <p className="claim-hint">
                                        One transaction. 10 FCT will be minted to your address.
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Contract addresses */}
                        <div className="panel">
                            <div className="panel-header">
                                <span className="panel-label">Contracts</span>
                            </div>
                            <div className="panel-body">
                                <div className="contract-list">
                                    <div className="contract-row">
                                        <span className="contract-row-label">Token</span>
                                        <span className="contract-row-addr">{shortAddr(contracts.token)}</span>
                                        <a
                                            href={"https://sepolia.etherscan.io/address/" + contracts.token}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="contract-row-link"
                                        >
                                            Etherscan
                                        </a>
                                    </div>
                                    <div className="contract-row">
                                        <span className="contract-row-label">Faucet</span>
                                        <span className="contract-row-addr">{shortAddr(contracts.faucet)}</span>
                                        <a
                                            href={"https://sepolia.etherscan.io/address/" + contracts.faucet}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="contract-row-link"
                                        >
                                            Etherscan
                                        </a>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </main>

            {/* Footer */}
            <footer className="footer">
                <span className="footer-text">Sepolia Testnet</span>
                <span className="footer-sep">·</span>
                <span className="footer-text">24h cooldown</span>
                <span className="footer-sep">·</span>
                <span className="footer-text">100 FCT lifetime max</span>
            </footer>

        </div>
    );
}
