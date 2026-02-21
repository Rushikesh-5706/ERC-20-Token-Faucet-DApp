const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("Account balance:", ethers.formatEther(balance), "ETH");

    if (parseFloat(ethers.formatEther(balance)) < 0.01) {
        throw new Error("Insufficient ETH. Get Sepolia ETH from https://sepoliafaucet.com");
    }

    console.log("\n1. Deploying Token...");
    const Token = await ethers.getContractFactory("Token");
    const token = await Token.deploy();
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    console.log("Token deployed to:", tokenAddress);

    console.log("\n2. Deploying TokenFaucet...");
    const TokenFaucet = await ethers.getContractFactory("TokenFaucet");
    const faucet = await TokenFaucet.deploy(tokenAddress);
    await faucet.waitForDeployment();
    const faucetAddress = await faucet.getAddress();
    console.log("TokenFaucet deployed to:", faucetAddress);

    console.log("\n3. Setting faucet as minter...");
    const tx = await token.setMinter(faucetAddress);
    await tx.wait();
    console.log("Faucet set as minter");

    const info = {
        network: hre.network.name,
        token: tokenAddress,
        faucet: faucetAddress,
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        blockNumber: await ethers.provider.getBlockNumber(),
    };

    const deploymentsDir = path.join(__dirname, "..", "deployments");
    if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);
    fs.writeFileSync(
        path.join(deploymentsDir, `${hre.network.name}.json`),
        JSON.stringify(info, null, 2)
    );

    console.log("\n=== DEPLOYMENT COMPLETE ===");
    console.log("Network:", hre.network.name);
    console.log("Token:", tokenAddress);
    console.log("Faucet:", faucetAddress);
    console.log("===========================");

    if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
        console.log("\nWaiting 30 seconds for Etherscan to index...");
        await new Promise((r) => setTimeout(r, 30000));

        if (process.env.ETHERSCAN_API_KEY) {
            console.log("\n4. Verifying Token on Etherscan...");
            try {
                await hre.run("verify:verify", {
                    address: tokenAddress,
                    constructorArguments: [],
                });
                console.log("Token verified on Etherscan");
            } catch (e) {
                console.log("Token verification note:", e.message);
            }

            console.log("\n5. Verifying TokenFaucet on Etherscan...");
            try {
                await hre.run("verify:verify", {
                    address: faucetAddress,
                    constructorArguments: [tokenAddress],
                });
                console.log("Faucet verified on Etherscan");
            } catch (e) {
                console.log("Faucet verification note:", e.message);
            }
        } else {
            console.log("\nNo ETHERSCAN_API_KEY found. Skipping auto-verification.");
            console.log("Run manually:");
            console.log(`npx hardhat verify --network ${hre.network.name} ${tokenAddress}`);
            console.log(`npx hardhat verify --network ${hre.network.name} ${faucetAddress} "${tokenAddress}"`);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
