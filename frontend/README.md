# PredictionDuel - Frontend

Next.js 15 (App Router) + TypeScript + wagmi v2 + viem + RainbowKit v2 +
Tailwind + sonner. Reads from and writes to the `PredictionDuel` and
`DuelReputation` contracts deployed on Sepolia.

## Setup

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

Contract addresses, chain id, RPC URL and (optionally) a WalletConnect project
id are read from `.env.local`. A working `.env.local` is committed pointing at
the existing Sepolia deployment; replace values to point at your own deployment.

To enable mobile and WalletConnect-based wallets, get a free project id at
https://cloud.reown.com/ and put it in `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
Without it, MetaMask / injected wallets still work.

## Updating contract ABIs

After re-compiling Solidity, regenerate the typed ABIs:

```bash
# from project root
node -e "const fs=require('fs');function emit(n,p){const a=JSON.parse(fs.readFileSync(p,'utf8'));fs.writeFileSync('frontend/lib/abis/'+n+'.ts','export const '+n+'Abi = '+JSON.stringify(a.abi,null,2)+' as const;\n');}emit('predictionDuel','artifacts/contracts/PredictionDuel.sol/PredictionDuel.json');emit('duelReputation','artifacts/contracts/DuelReputation.sol/DuelReputation.json');"
```

`as const` is important - wagmi v2 derives strict argument and return types
from the literal ABI.
