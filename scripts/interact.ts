/**
 * Smoke-test against a deployed PredictionDuel by creating a 0.001-ETH duel.
 *
 * Reads the contract address from `deployments/<network>.json` and posts a
 * single `createDuel(...)` transaction. Logs the duel id, tx hash, and a
 * link to the transaction on Etherscan when running on a public network.
 *
 * Usage:
 *   npx hardhat run scripts/interact.ts --network sepolia
 */

import { network } from "hardhat";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

type Deployment = {
  contracts: Record<string, { address: string }>;
};

const ETHERSCAN_TX_PREFIX: Record<string, string> = {
  sepolia: "https://sepolia.etherscan.io/tx/",
  mainnet: "https://etherscan.io/tx/",
};

const QUESTION = "PredictionDuel smoke test: will this duel settle by deadline?";
const DESCRIPTION =
  "Automated smoke test created by scripts/interact.ts. Resolution: settles YES if the deployment harness succeeds.";
const Outcome = { NONE: 0, YES: 1, NO: 2, INVALID: 3 } as const;

async function main() {
  const conn = await network.connect();
  const { ethers } = conn;
  const networkName = conn.networkName;

  const file = path.resolve(process.cwd(), "deployments", `${networkName}.json`);
  if (!existsSync(file)) {
    throw new Error(`No deployment record at ${file}. Run scripts/deploy.ts first.`);
  }
  const deployment = JSON.parse(readFileSync(file, "utf8")) as Deployment;
  const duelAddr = deployment.contracts.PredictionDuel.address;

  const [signer] = await ethers.getSigners();
  const signerAddr = await signer.getAddress();
  const balance = await ethers.provider.getBalance(signerAddr);

  console.log(`Network:          ${networkName}`);
  console.log(`Caller:           ${signerAddr}`);
  console.log(`Caller balance:   ${ethers.formatEther(balance)} ETH`);
  console.log(`PredictionDuel:   ${duelAddr}\n`);

  const duel = await ethers.getContractAt("PredictionDuel", duelAddr, signer);

  const creatorStake = ethers.parseEther("0.001");
  const opponentStake = ethers.parseEther("0.001");
  const noRepGate = 0n;

  const latestBlock = await ethers.provider.getBlock("latest");
  if (!latestBlock) throw new Error("Could not fetch latest block.");
  const now = Number(latestBlock.timestamp);
  const votingStart = BigInt(now + 60 * 60); // 1 hour: voting opens
  const voteDeadline = BigInt(now + 2 * 60 * 60); // 2 hours: voting closes
  const resolutionDeadline = BigInt(now + 3 * 60 * 60); // 3 hours

  console.log(`Creating duel: stake ${ethers.formatEther(creatorStake)} ETH`);
  console.log(`  votingStart:         ${votingStart}  (~${new Date(Number(votingStart) * 1000).toISOString()})`);
  console.log(`  voteDeadline:        ${voteDeadline}  (~${new Date(Number(voteDeadline) * 1000).toISOString()})`);
  console.log(`  resolutionDeadline:  ${resolutionDeadline}\n`);

  const tx = await duel.createDuel(
    QUESTION,
    DESCRIPTION,
    Outcome.YES,
    opponentStake,
    noRepGate,
    votingStart,
    voteDeadline,
    resolutionDeadline,
    { value: creatorStake },
  );
  console.log(`Submitted tx: ${tx.hash}`);
  const txPrefix = ETHERSCAN_TX_PREFIX[networkName];
  if (txPrefix) console.log(`              ${txPrefix}${tx.hash}`);

  const receipt = await tx.wait();
  if (!receipt) throw new Error("No receipt for createDuel tx.");

  // Pull the duel id from the DuelCreated event.
  let duelId: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      const parsed = duel.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "DuelCreated") {
        duelId = parsed.args.id as bigint;
        break;
      }
    } catch {
      /* not our event */
    }
  }

  console.log(`\nMined in block ${receipt.blockNumber}.`);
  console.log(`Duel id: ${duelId ?? "<event not found>"}`);
  console.log(`Gas used: ${receipt.gasUsed.toString()}`);

  if (duelId !== null) {
    const stored = await duel.getDuel(duelId);
    console.log(`\nOn-chain state:`);
    console.log(`  creator:        ${stored.creator}`);
    console.log(`  creatorStake:   ${ethers.formatEther(stored.creatorStake)} ETH`);
    console.log(`  opponentStake:  ${ethers.formatEther(stored.opponentStake)} ETH`);
    console.log(`  status:         ${stored.status} (0=CREATED)`);
    console.log(`  votingStart:    ${stored.votingStart}`);
    console.log(`  question:       ${stored.question}`);
    if (stored.description) console.log(`  description:    ${stored.description}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});