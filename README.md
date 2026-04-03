# ows-train

Cross-chain token bridge via [Train Protocol](https://train.tech) HTLC atomic swaps, powered by [OWS](https://github.com/OpenWalletStandard) wallets for signing.

## Install

```bash
npm install -g @open-wallet-standard/train
```

Requires Node.js >= 20 and the [OWS CLI](https://github.com/OpenWalletStandard/ows) installed.

## Commands

```
ows-train bridge     Lock funds and bridge tokens across chains
ows-train refund     Refund a locked HTLC after timelock expires
ows-train redeem     Redeem a solver lock using the HTLC secret
ows-train pay        Bridge funds then pay an HTTP 402 endpoint via ows pay
```

Run `ows-train --help` or `ows-train <command> --help` for full options.

## Quick Start

```bash
# Create a wallet
ows wallet create --name my-wallet

# Bridge 0.005 ETH from Sepolia to Base Sepolia
ows-train bridge \
  -w my-wallet \
  -f sepolia \
  -t base-sepolia \
  --token ETH \
  -a 0.005 \
  --api-url https://train-solver-station.lb.layerswap.io

# Bridge ETH to USDC cross-chain
ows-train bridge \
  -w my-wallet \
  -f sepolia \
  -t base-sepolia \
  --token ETH \
  --dest-token USDC \
  -r 10 \
  --api-url https://train-solver-station.lb.layerswap.io
```

## Bridge

```bash
ows-train bridge -w <wallet> -f <source> -t <dest> --token <symbol> -a <amount>
ows-train bridge -w <wallet> -f <source> -t <dest> --token <symbol> -r <receive-amount>
```

| Flag | Short | Description |
|------|-------|-------------|
| `--wallet` | `-w` | OWS wallet name |
| `--from` | `-f` | Source chain |
| `--to` | `-t` | Destination chain |
| `--token` | | Token symbol (e.g. ETH, USDC) |
| `--amount` | `-a` | Amount to lock on source |
| `--receive-amount` | `-r` | Amount to receive on destination |
| `--dest-token` | | Destination token (defaults to source token) |
| `--dest-address` | | Custom destination address |
| `--api-url` | | Train API URL (or `TRAIN_API_URL` env) |
| `--source-rpc` | | Source chain RPC override |
| `--dest-rpc` | | Destination chain RPC override |
| `--timeout` | | Solver timeout in ms (default: 120000) |

## Refund

Recover funds from a failed or timed-out bridge after the HTLC timelock expires.

```bash
ows-train refund -w <wallet> -c <chain> --hashlock <hash> --token <symbol>
```

| Flag | Short | Description |
|------|-------|-------------|
| `--wallet` | `-w` | OWS wallet name |
| `--chain` | `-c` | Chain where funds are locked |
| `--hashlock` | | HTLC hashlock |
| `--token` | | Token symbol |
| `--api-url` | | Train API URL (or `TRAIN_API_URL` env) |
| `--rpc-url` | | RPC URL override |
| `--index` | | Solver lock index (omit for user refund) |

## Redeem

Manually claim solver funds using the HTLC secret when the automatic flow didn't complete.

```bash
ows-train redeem -w <wallet> -c <chain> --hashlock <hash> --secret <hex> --token <symbol>
```

| Flag | Short | Description |
|------|-------|-------------|
| `--wallet` | `-w` | OWS wallet name |
| `--chain` | `-c` | Chain where solver locked funds |
| `--hashlock` | | HTLC hashlock |
| `--secret` | | HTLC secret / preimage |
| `--token` | | Token symbol |
| `--api-url` | | Train API URL (or `TRAIN_API_URL` env) |
| `--rpc-url` | | RPC URL override |
| `--index` | | Solver lock index (default: 0) |

## Pay (HTTP 402)

Bridge funds cross-chain and pay for paywalled resources. Detects x402/MPP protocol automatically, bridges to the payment chain, then delegates to `ows pay request`.

```bash
ows-train pay <url> -w <wallet> --source-chain <chain>
```

| Flag | Short | Description |
|------|-------|-------------|
| `--wallet` | `-w` | OWS wallet name |
| `--source-chain` | `-f` | Chain where your funds are |
| `--source-token` | | Token to pay with (defaults to what server requires) |
| `--api-url` | | Train API URL (or `TRAIN_API_URL` env) |
| `--method` | `-m` | HTTP method (default: GET) |
| `--header` | `-H` | HTTP header (repeatable) |
| `--data` | `-d` | Request body |

```bash
# Pay for a paywalled API
ows-train pay https://www.x402.org/protected \
  -w my-wallet \
  --source-chain sepolia \
  --api-url https://train-solver-station.lb.layerswap.io
```

## Supported Chains

| Chain | Name | CAIP-2 |
|-------|------|--------|
| Ethereum | `ethereum` | eip155:1 |
| Sepolia | `sepolia` | eip155:11155111 |
| Base | `base` | eip155:8453 |
| Base Sepolia | `base-sepolia` | eip155:84532 |
| Arbitrum | `arbitrum` | eip155:42161 |
| Arbitrum Sepolia | `arbitrum-sepolia` | eip155:421614 |
| Optimism | `optimism` | eip155:10 |
| Polygon | `polygon` | eip155:137 |
| BSC | `bsc` | eip155:56 |
| Avalanche | `avalanche` | eip155:43114 |
| Linea | `linea` | eip155:59144 |
| Scroll | `scroll` | eip155:534352 |
| zkSync | `zksync` | eip155:324 |
| Solana | `solana` | solana:5eykt4U... |
| Solana Devnet | `solana-devnet` | solana:EtWTRAB... |
| Starknet | `starknet` | starknet:SN_MAIN |
| Starknet Sepolia | `starknet-sepolia` | starknet:SN_SEPOLIA |
| TON | `ton` | ton:mainnet |
| Tron | `tron` | tron:mainnet |

Public fallback RPCs are built-in. Token metadata and HTLC contract addresses are resolved from the Train API at runtime.

## How It Works

Train Protocol uses HTLC (Hashed Time-Locked Contracts) for trustless cross-chain swaps:

1. **Quote** — query Train solvers for the best rate
2. **Lock** — user locks funds on the source chain with a hashlock + timelock
3. **Solver lock** — solver locks matching funds on the destination chain
4. **Verify** — confirm solver locked the correct amount/token/recipient
5. **Reveal** — send the secret to the solver
6. **Complete** — solver redeems on source, user receives on destination

If the solver never locks, the user can **refund** after the timelock expires. If the flow stalls after the solver locks, the user can **redeem** directly with the secret.

## Library Usage

```typescript
import { bridge, refund, redeem, payAndAccess } from '@open-wallet-standard/train'

const result = await bridge({
  wallet: 'my-wallet',
  sourceChain: 'sepolia',
  destinationChain: 'base-sepolia',
  token: 'ETH',
  amount: '0.005',
  trainApiUrl: 'https://train-solver-station.lb.layerswap.io',
  onProgress: (event) => console.log(event.message),
})

console.log(result.status)        // 'completed'
console.log(result.hashlock)      // '0x...'
console.log(result.sourceTxHash)  // '0x...'
```

## Development

```bash
npm install
npm run build        # compile TypeScript
npm run dev          # watch mode
npm run check:types  # type-check without emitting
```

## License

MIT
