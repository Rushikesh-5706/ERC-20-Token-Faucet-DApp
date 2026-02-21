export const TOKEN_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transferFrom(address from, address to, uint256 amount) returns (bool)",
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "event Approval(address indexed owner, address indexed spender, uint256 value)",
];

export const FAUCET_ABI = [
    "function requestTokens() external",
    "function canClaim(address user) view returns (bool)",
    "function remainingAllowance(address user) view returns (uint256)",
    "function isPaused() view returns (bool)",
    "function lastClaimAt(address user) view returns (uint256)",
    "function totalClaimed(address user) view returns (uint256)",
    "function timeUntilNextClaim(address user) view returns (uint256)",
    "function FAUCET_AMOUNT() view returns (uint256)",
    "function COOLDOWN_TIME() view returns (uint256)",
    "function MAX_CLAIM_AMOUNT() view returns (uint256)",
    "event TokensClaimed(address indexed user, uint256 amount, uint256 timestamp)",
    "event FaucetPaused(bool paused)",
];
