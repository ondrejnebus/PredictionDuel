/**
 * Deploys DuelReputation + PredictionDuel and persists addresses to
 * `deployments/<network>.json`.
 *
 * The two contracts reference each other in their constructors:
 *   - DuelReputation(address duelContract)   <- needs PredictionDuel address
 *   - PredictionDuel(address reputationAddr) <- needs DuelReputation address
 *
 * `DuelReputation.duelContract` is `immutable`, so we cannot patch it after
 * deployment. We use the **counterfactual** pattern: predict PredictionDuel's
 * future CREATE address (deployer's nonce + 1) and pass it to DuelReputation
 * at construction time. The same pattern is used in the test fixtures.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network hardhat
 *   npx hardhat run scripts/deploy.ts --network sepolia
 */

import { network } from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

async function main() {
  const conn = await network.connect();
  const { ethers } = conn;
  const networkName = conn.networkName;

  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddr);

  console.log("=".repeat(60));
  console.log(`Network:  ${networkName}`);
  console.log(`Deployer: ${deployerAddr}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH`);
  console.log("=".repeat(60));

  if (balance === 0n) {
    throw new Error("Deployer has no ETH. Fund the account before deploying.");
  }

  // Counterfactual: PredictionDuel will be deployed at nonce+1.
  const nonce = await ethers.provider.getTransactionCount(deployerAddr);
  const predictedDuelAddr = ethers.getCreateAddress({
    from: deployerAddr,
    nonce: nonce + 1,
  });
  console.log(`\nPredicted PredictionDuel address: ${predictedDuelAddr}`);

  console.log("\n[1/2] Deploying DuelReputation...");
  const reputation = await ethers.deployContract("DuelReputation", [predictedDuelAddr]);
  await reputation.waitForDeployment();
  const reputationAddr = await reputation.getAddress();
  const reputationDeployTx = reputation.deploymentTransaction();
  console.log(`  -> ${reputationAddr}`);
  console.log(`     tx: ${reputationDeployTx?.hash}`);

  console.log("\n[2/2] Deploying PredictionDuel...");
  const duel = await ethers.deployContract("PredictionDuel", [reputationAddr]);
  await duel.waitForDeployment();
  const duelAddr = await duel.getAddress();
  const duelDeployTx = duel.deploymentTransaction();
  console.log(`  -> ${duelAddr}`);
  console.log(`     tx: ${duelDeployTx?.hash}`);

  if (duelAddr.toLowerCase() !== predictedDuelAddr.toLowerCase()) {
    throw new Error(
      `Address prediction failed: expected ${predictedDuelAddr}, got ${duelAddr}. ` +
        `The contracts cannot be linked.`,
    );
  }

  // Sanity-check the on-chain wiring.
  const linkedRep = await duel.reputation();
  const linkedDuel = await reputation.duelContract();
  if (linkedRep.toLowerCase() !== reputationAddr.toLowerCase()) {
    throw new Error(`PredictionDuel.reputation mismatch: ${linkedRep}`);
  }
  if (linkedDuel.toLowerCase() !== duelAddr.toLowerCase()) {
    throw new Error(`DuelReputation.duelContract mismatch: ${linkedDuel}`);
  }
  console.log("\nLink check: contracts mutually reference each other. OK.");

  // Persist addresses.
  const deploymentsDir = path.resolve(process.cwd(), "deployments");
  mkdirSync(deploymentsDir, { recursive: true });
  const outFile = path.join(deploymentsDir, `${networkName}.json`);

  const record = {
    network: networkName,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployerAddr,
    timestamp: new Date().toISOString(),
    contracts: {
      DuelReputation: {
        address: reputationAddr,
        constructorArgs: [predictedDuelAddr],
        deploymentTx: reputationDeployTx?.hash ?? null,
      },
      PredictionDuel: {
        address: duelAddr,
        constructorArgs: [reputationAddr],
        deploymentTx: duelDeployTx?.hash ?? null,
      },
    },
  };
  writeFileSync(outFile, JSON.stringify(record, null, 2) + "\n");
  console.log(`\nDeployment record saved to: ${path.relative(process.cwd(), outFile)}`);

  // Print verification commands (skipped for in-memory networks).
  const isLocal = networkName === "hardhat" || networkName === "localhost";
  if (!isLocal) {
    console.log("\nTo verify on Etherscan:");
    console.log(
      `  npx hardhat verify etherscan --network ${networkName} ${reputationAddr} ${predictedDuelAddr}`,
    );
    console.log(
      `  npx hardhat verify etherscan --network ${networkName} ${duelAddr} ${reputationAddr}`,
    );
    console.log(`\nOr run:  npx hardhat run scripts/verify.ts --network ${networkName}`);
  } else {
    console.log("\n(Local network — skipping Etherscan verification hint.)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});