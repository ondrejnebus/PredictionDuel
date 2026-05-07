/**
 * Reads `deployments/<network>.json` and runs Etherscan verification for both
 * contracts.
 *
 * Usage:
 *   npx hardhat run scripts/verify.ts --network sepolia
 */

import { network } from "hardhat";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

type Deployment = {
  contracts: Record<string, { address: string; constructorArgs: string[] }>;
};

function runVerify(networkName: string, address: string, args: string[]) {
  const cmd = "npx";
  const cmdArgs = [
    "hardhat",
    "verify",
    "etherscan",
    "--network",
    networkName,
    address,
    ...args,
  ];
  console.log(`\n$ ${cmd} ${cmdArgs.join(" ")}`);
  const result = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.warn(`  verify exited with status ${result.status} for ${address}`);
  }
}

async function main() {
  const conn = await network.connect();
  const networkName = conn.networkName;

  if (networkName === "hardhat" || networkName === "localhost") {
    throw new Error(
      `Cannot verify on a local network (got '${networkName}'). Pass --network sepolia.`,
    );
  }

  const file = path.resolve(process.cwd(), "deployments", `${networkName}.json`);
  if (!existsSync(file)) {
    throw new Error(`No deployment record at ${file}. Run scripts/deploy.ts first.`);
  }

  const deployment = JSON.parse(readFileSync(file, "utf8")) as Deployment;
  const { DuelReputation, PredictionDuel } = deployment.contracts;

  console.log(`Verifying contracts on ${networkName}...`);
  runVerify(networkName, DuelReputation.address, DuelReputation.constructorArgs);
  runVerify(networkName, PredictionDuel.address, PredictionDuel.constructorArgs);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});