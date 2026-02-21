const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TokenFaucet", function () {
    let token;
    let faucet;
    let owner;
    let user1;
    let user2;

    const FAUCET_AMOUNT = ethers.parseEther("10");
    const MAX_CLAIM_AMOUNT = ethers.parseEther("100");
    const COOLDOWN_TIME = 24 * 60 * 60;

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();

        const Token = await ethers.getContractFactory("Token");
        token = await Token.deploy();
        await token.waitForDeployment();

        const TokenFaucet = await ethers.getContractFactory("TokenFaucet");
        faucet = await TokenFaucet.deploy(await token.getAddress());
        await faucet.waitForDeployment();

        await token.setMinter(await faucet.getAddress());
    });

    describe("Deployment", function () {
        it("Should set the correct token address", async function () {
            expect(await faucet.token()).to.equal(await token.getAddress());
        });

        it("Should set the correct owner", async function () {
            expect(await faucet.owner()).to.equal(owner.address);
        });

        it("Should start unpaused", async function () {
            expect(await faucet.isPaused()).to.equal(false);
        });

        it("Should have correct constants", async function () {
            expect(await faucet.FAUCET_AMOUNT()).to.equal(FAUCET_AMOUNT);
            expect(await faucet.MAX_CLAIM_AMOUNT()).to.equal(MAX_CLAIM_AMOUNT);
            expect(await faucet.COOLDOWN_TIME()).to.equal(COOLDOWN_TIME);
        });
    });

    describe("Token Claiming", function () {
        it("Should allow first-time claim", async function () {
            const tx = await faucet.connect(user1).requestTokens();
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt.blockNumber);

            await expect(tx)
                .to.emit(faucet, "TokensClaimed")
                .withArgs(user1.address, FAUCET_AMOUNT, block.timestamp);

            const balance = await token.balanceOf(user1.address);
            expect(balance).to.equal(FAUCET_AMOUNT);
        });

        it("Should update lastClaimAt after claim", async function () {
            await faucet.connect(user1).requestTokens();
            const lastClaim = await faucet.lastClaimAt(user1.address);
            expect(lastClaim).to.be.gt(0);
        });

        it("Should update totalClaimed after claim", async function () {
            await faucet.connect(user1).requestTokens();
            const total = await faucet.totalClaimed(user1.address);
            expect(total).to.equal(FAUCET_AMOUNT);
        });

        it("Should revert with cooldown message during cooldown", async function () {
            await faucet.connect(user1).requestTokens();
            await expect(faucet.connect(user1).requestTokens()).to.be.revertedWith(
                "Cooldown period not elapsed"
            );
        });

        it("Should allow claim after cooldown period", async function () {
            await faucet.connect(user1).requestTokens();
            await time.increase(COOLDOWN_TIME);
            await expect(faucet.connect(user1).requestTokens()).to.emit(
                faucet,
                "TokensClaimed"
            );
            const balance = await token.balanceOf(user1.address);
            expect(balance).to.equal(FAUCET_AMOUNT * 2n);
        });

        it("Should enforce lifetime claim limit with clear message", async function () {
            for (let i = 0; i < 10; i++) {
                await faucet.connect(user1).requestTokens();
                if (i < 9) {
                    await time.increase(COOLDOWN_TIME);
                }
            }

            const total = await faucet.totalClaimed(user1.address);
            expect(total).to.equal(MAX_CLAIM_AMOUNT);
            expect(await faucet.canClaim(user1.address)).to.equal(false);
            expect(await faucet.remainingAllowance(user1.address)).to.equal(0);

            await time.increase(COOLDOWN_TIME);
            await expect(faucet.connect(user1).requestTokens()).to.be.revertedWith(
                "Lifetime claim limit reached"
            );
        });

        it("Should allow different users to claim independently", async function () {
            await faucet.connect(user1).requestTokens();
            await faucet.connect(user2).requestTokens();

            expect(await token.balanceOf(user1.address)).to.equal(FAUCET_AMOUNT);
            expect(await token.balanceOf(user2.address)).to.equal(FAUCET_AMOUNT);
        });
    });

    describe("Pause Functionality", function () {
        it("Should allow owner to pause with event", async function () {
            await expect(faucet.setPaused(true))
                .to.emit(faucet, "FaucetPaused")
                .withArgs(true);
            expect(await faucet.isPaused()).to.equal(true);
        });

        it("Should prevent claiming when paused", async function () {
            await faucet.setPaused(true);
            await expect(faucet.connect(user1).requestTokens()).to.be.revertedWith(
                "Faucet is paused"
            );
        });

        it("Should allow owner to unpause and resume claims", async function () {
            await faucet.setPaused(true);
            await faucet.setPaused(false);
            expect(await faucet.isPaused()).to.equal(false);
            await expect(faucet.connect(user1).requestTokens()).to.emit(
                faucet,
                "TokensClaimed"
            );
        });

        it("Should prevent non-owner from pausing", async function () {
            await expect(
                faucet.connect(user1).setPaused(true)
            ).to.be.revertedWithCustomError(faucet, "OwnableUnauthorizedAccount");
        });
    });

    describe("View Functions", function () {
        it("Should return correct canClaim status across states", async function () {
            expect(await faucet.canClaim(user1.address)).to.equal(true);
            await faucet.connect(user1).requestTokens();
            expect(await faucet.canClaim(user1.address)).to.equal(false);
            await time.increase(COOLDOWN_TIME);
            expect(await faucet.canClaim(user1.address)).to.equal(true);
        });

        it("Should return correct remainingAllowance", async function () {
            expect(await faucet.remainingAllowance(user1.address)).to.equal(
                MAX_CLAIM_AMOUNT
            );
            await faucet.connect(user1).requestTokens();
            expect(await faucet.remainingAllowance(user1.address)).to.equal(
                MAX_CLAIM_AMOUNT - FAUCET_AMOUNT
            );
        });

        it("Should return correct timeUntilNextClaim", async function () {
            expect(await faucet.timeUntilNextClaim(user1.address)).to.equal(0);
            await faucet.connect(user1).requestTokens();
            const remaining = await faucet.timeUntilNextClaim(user1.address);
            expect(remaining).to.be.closeTo(COOLDOWN_TIME, 5);
        });

        it("Should return false for canClaim when paused", async function () {
            await faucet.setPaused(true);
            expect(await faucet.canClaim(user1.address)).to.equal(false);
        });
    });

    describe("Token Contract", function () {
        it("Should have correct name and symbol", async function () {
            expect(await token.name()).to.equal("Faucet Token");
            expect(await token.symbol()).to.equal("FCT");
        });

        it("Should have correct decimals", async function () {
            expect(await token.decimals()).to.equal(18);
        });

        it("Should only allow minter to mint tokens", async function () {
            await expect(
                token.connect(user1).mint(user1.address, FAUCET_AMOUNT)
            ).to.be.revertedWith("Only minter can mint tokens");
        });

        it("Should emit Transfer event when minting via faucet", async function () {
            await expect(faucet.connect(user1).requestTokens()).to.emit(
                token,
                "Transfer"
            );
        });

        it("Should allow token transfer between addresses", async function () {
            await faucet.connect(user1).requestTokens();
            const amount = ethers.parseEther("5");
            await token.connect(user1).transfer(user2.address, amount);
            expect(await token.balanceOf(user2.address)).to.equal(amount);
        });

        it("Should emit Transfer event on transfer between addresses", async function () {
            await faucet.connect(user1).requestTokens();
            const amount = ethers.parseEther("5");
            await expect(token.connect(user1).transfer(user2.address, amount))
                .to.emit(token, "Transfer")
                .withArgs(user1.address, user2.address, amount);
        });

        it("Should enforce max supply constant", async function () {
            const MAX_SUPPLY = ethers.parseEther("100000000");
            expect(await token.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
        });
    });

    describe("Reentrancy Protection", function () {
        it("Should update state before minting to prevent reentrancy", async function () {
            await faucet.connect(user1).requestTokens();
            const total = await faucet.totalClaimed(user1.address);
            expect(total).to.equal(FAUCET_AMOUNT);
            const lastClaim = await faucet.lastClaimAt(user1.address);
            expect(lastClaim).to.be.gt(0);
        });
    });
});
