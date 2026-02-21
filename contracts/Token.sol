// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Token
 * @dev ERC-20 token with minting controlled by the faucet contract.
 * Maximum supply of 100 million tokens is enforced at mint time.
 */
contract Token is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10 ** 18;

    address public minter;

    event MinterUpdated(address indexed newMinter);

    constructor() ERC20("Faucet Token", "FCT") Ownable(msg.sender) {}

    /**
     * @dev Sets the authorized minter. Only callable by owner.
     * Called once after faucet is deployed to grant it mint rights.
     */
    function setMinter(address _minter) external onlyOwner {
        require(_minter != address(0), "Minter cannot be zero address");
        minter = _minter;
        emit MinterUpdated(_minter);
    }

    /**
     * @dev Mints tokens. Only callable by the faucet contract.
     */
    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "Only minter can mint tokens");
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds maximum supply");
        require(to != address(0), "Cannot mint to zero address");
        _mint(to, amount);
    }
}
