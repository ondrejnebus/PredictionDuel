# PredictionDuel

A Solidity smart-contract dApp for head-to-head prediction duels, built on **Hardhat 3** with TypeScript and **ethers v6**.

## Project Structure

```
PredictionDuel/
├── contracts/            # Solidity source files
├── test/                 # Mocha + Chai tests (TypeScript) - also Foundry-style .t.sol welcome
├── scripts/              # Standalone task / utility scripts
├── ignition/             # Hardhat Ignition deployment modules (created on demand)
├── hardhat.config.ts     # Hardhat 3 configuration
├── tsconfig.json         # TypeScript configuration (ESM, node16)
├── .env.example          # Template for environment variables
├── .gitignore
├── package.json          # "type": "module" - Hardhat 3 requires ESM
└── README.md
```

## Tech stack

- [Hardhat 3](https://hardhat.org/) with `@nomicfoundation/hardhat-toolbox-mocha-ethers` (bundles `hardhat-ethers`, `hardhat-mocha`, `hardhat-network-helpers`, `hardhat-verify`, `hardhat-ignition-ethers`, `hardhat-typechain`, `hardhat-keystore`, `hardhat-ethers-chai-matchers`)
- TypeScript (ESM, `module: node16`)
- [ethers v6](https://docs.ethers.org/v6/)
- **Solidity 0.8.35** with the optimizer enabled (`runs: 200`)
- [@openzeppelin/contracts](https://docs.openzeppelin.com/contracts/) v5
- **Built-in coverage** via `hardhat coverage` (no `solidity-coverage` plugin required in HH3)

## Setup

```bash
npm install
cp .env.example .env # then fill in values
```

### Environment variables

`.env` is auto-loaded at the top of `hardhat.config.ts` via `dotenv/config`. The values are read lazily through Hardhat 3's `configVariable(...)`, so they're only required when a task actually needs them (e.g. `--network sepolia`, `hardhat verify`).

| Key                 | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `SEPOLIA_RPC_URL`   | RPC endpoint for the Sepolia testnet             |
| `PRIVATE_KEY`       | Deployer wallet private key (with or without `0x`) |
| `ETHERSCAN_API_KEY` | Etherscan v2 API key (single key works across all supported chains) |

For production secrets, prefer Hardhat 3's encrypted **keystore** instead of plain `.env`:

```bash
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set PRIVATE_KEY
npx hardhat keystore set ETHERSCAN_API_KEY
```

`configVariable(...)` resolves from the keystore first, then falls back to `process.env` (and thus `.env`).

## Common commands

```bash
npm run compile                    # hardhat compile
npm test                           # hardhat test (mocha + solidity tests)
npm run coverage                   # hardhat test --coverage  (built into HH3)
npm run test:gas                   # hardhat test --gas-stats (gas report)
npm run clean                      # hardhat clean
npm run node                       # local in-process node

# Deployment via Hardhat Ignition (recommended in HH3):
npx hardhat ignition deploy ignition/modules/<Module>.ts --network sepolia

# Verify on Etherscan (single API key, all chains):
npx hardhat verify --network sepolia <address> <constructor-args...>
```

## Networks

- `hardhat` - in-process EDR-simulated L1 (default)
- `sepolia` - public Ethereum testnet, configured via `SEPOLIA_RPC_URL` and `PRIVATE_KEY`

## Notes on the Hardhat 3 migration

- The project is **ESM** (`"type": "module"`). Config and scripts use `import`, not `require`.
- `solidity-coverage` is **not** used; HH3 ships native coverage.
- Plugins are registered via the `plugins: [...]` array in `defineConfig`, not auto-imported.
- Networks must declare a `type` (`edr-simulated` or `http`) and a `chainType` (`l1` / `op`).
- Etherscan verification uses a single `apiKey` (Etherscan v2).