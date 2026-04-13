---
name: train
description: "Cross-chain token bridge via Train Protocol — HTLC atomic swaps using OWS wallets."
version: 0.3.0
metadata:
  openclaw:
    requires:
      anyBins:
        - ows
        - ows-train
    emoji: "\U0001F682"
    homepage: https://train.tech
    os:
      - darwin
      - linux
    install:
      - kind: node
        package: "@open-wallet-standard/train"
        bins: [ows-train]
        label: Install Train Protocol bridge CLI
---

# Train Protocol Bridge

Cross-chain token bridging via Train Protocol HTLC atomic swaps, powered by OWS wallets for signing. Also supports paying for HTTP 402 (x402) paywalled APIs by bridging funds cross-chain — the Train HTLC contract natively supports EIP-3009, so the payment is settled via standard `transferWithAuthorization` without needing a separate payment step.

## When to use

Use this skill when:
- Cross-chain swap or transfer                                                                               
- Move assets from one network to another                                                                    
- Use Train Protocol for bridging                                                                            
- Execute an HTLC atomic swap  
- The user asks to **bridge tokens between chains** (e.g. "bridge ETH from sepolia to arbitrum", "move assets cross-chain", "cross-chain swap")
- The user asks to **refund** a stuck or timed-out HTLC lock
- The user asks to **redeem** a solver lock manually using a secret
- **An HTTP 402 paywall is encountered** — use `ows-train pay` to bridge funds from any chain and pay in one step. Train bridges funds to the server's address via HTLC, then builds an EIP-3009 `transferWithAuthorization` payload from the HTLC secret, which the x402 facilitator settles on-chain.
- The user explicitly asks to pay with tokens on a different chain than what the server requires

## Important Agent Instructions

**CRITICAL — follow these rules when executing commands:**

1. **Use the `ows-train` CLI.** Do NOT write scripts. Just run the command.
2. **No passphrase needed.** OWS wallets created without a passphrase do NOT require `OWS_PASSPHRASE`. Do not ask the user for it.
3. **Default Train API URL:** `https://train-solver-station.lb.layerswap.io` — use this unless the user specifies another.
4. **Solver minimum amounts:** Solvers enforce minimum bridge amounts (varies by route). If the error says `"Amount is less than min amount X"`, tell the user the minimum and ask to adjust.
5. **The bridge takes 20-60 seconds.** Run with a timeout of at least 300 seconds.
6. **RPC URLs are optional.** Public fallback RPCs are built-in for all supported chains. Override with `--source-rpc` / `--dest-rpc` if needed.
7. **Use `--help` on any subcommand** for full option details: `ows-train <command> --help`

## Commands Overview

| Command | Description |
|---------|-------------|
| `ows-train bridge` | Lock funds and bridge tokens across chains |
| `ows-train refund` | Refund a locked HTLC after timelock expires |
| `ows-train redeem` | Redeem a solver lock using the HTLC secret |
| `ows-train pay` | Bridge funds cross-chain and pay x402/MPP paywalls |

## Bridge

```bash
ows-train bridge \
  -w <wallet-name> \
  -f <source-chain> \
  -t <dest-chain> \
  --token <symbol> \
  -a <amount> \
  --api-url <train-api-url>
```

### Bridge Options

| Flag | Short | Description | Required |
|------|-------|-------------|----------|
| `--wallet` | `-w` | OWS wallet name | Yes |
| `--from` | `-f` | Source chain name | Yes |
| `--to` | `-t` | Destination chain name | Yes |
| `--token` | | Token symbol (e.g. ETH, USDC) | Yes |
| `--amount` | `-a` | Amount to lock on source chain (e.g. "0.001") | One of `-a` or `-r` |
| `--receive-amount` | `-r` | Amount to receive on destination chain | One of `-a` or `-r` |
| `--api-url` | | Train API URL (default: Train Station) | No |
| `--source-rpc` | | Source chain RPC override | No |
| `--dest-rpc` | | Destination chain RPC override | No |
| `--dest-address` | | Custom destination address (defaults to wallet's own) | No |
| `--dest-token` | | Destination token symbol (defaults to `--token`) | No |
| `--timeout` | | Solver timeout in ms (default: 120000) | No |

### Bridge Examples

```bash
# Bridge 0.005 ETH from Sepolia to Base Sepolia
ows-train bridge \
  -w agent-treasury \
  -f sepolia \
  -t base-sepolia \
  --token ETH \
  -a 0.005

# Bridge ETH to USDC cross-chain
ows-train bridge \
  -w agent-treasury \
  -f sepolia \
  -t base-sepolia \
  --token ETH \
  --dest-token USDC \
  -r 10

# Bridge to a specific destination address
ows-train bridge \
  -w agent-treasury \
  -f sepolia \
  -t arbitrum-sepolia \
  --token ETH \
  -a 0.001 \
  --dest-address 0xYourDestAddress
```

## Refund

Refund a user lock after the HTLC timelock has expired. Use this when a bridge failed (solver never locked) and you need to recover funds.

```bash
ows-train refund \
  -w <wallet-name> \
  -c <chain> \
  --hashlock <hash> \
  --token <symbol> \
  --api-url <train-api-url>
```

### Refund Options

| Flag | Short | Description | Required |
|------|-------|-------------|----------|
| `--wallet` | `-w` | OWS wallet name | Yes |
| `--chain` | `-c` | Chain where funds are locked | Yes |
| `--hashlock` | | HTLC hashlock | Yes |
| `--token` | | Token symbol | Yes |
| `--api-url` | | Train API URL (default: Train Station) | No |
| `--rpc-url` | | RPC URL override | No |
| `--index` | | Solver lock index (omit for user refund) | No |

### Refund Example

```bash
# Refund a stuck bridge after timelock expired
ows-train refund \
  -w agent-treasury \
  -c sepolia \
  --hashlock 0xabc123... \
  --token ETH
```

## Redeem

Redeem a solver lock using the HTLC secret. Use this when the solver locked funds on the destination chain but the automatic flow didn't complete.

```bash
ows-train redeem \
  -w <wallet-name> \
  -c <chain> \
  --hashlock <hash> \
  --secret <hex> \
  --token <symbol> \
  --api-url <train-api-url>
```

### Redeem Options

| Flag | Short | Description | Required |
|------|-------|-------------|----------|
| `--wallet` | `-w` | OWS wallet name | Yes |
| `--chain` | `-c` | Chain where solver locked funds | Yes |
| `--hashlock` | | HTLC hashlock | Yes |
| `--secret` | | HTLC secret / preimage | Yes |
| `--token` | | Token symbol | Yes |
| `--api-url` | | Train API URL (default: Train Station) | No |
| `--rpc-url` | | RPC URL override | No |
| `--index` | | Solver lock index (default: 0) | No |

### Redeem Example

```bash
# Redeem solver's funds on Base Sepolia
ows-train redeem \
  -w agent-treasury \
  -c base-sepolia \
  --hashlock 0xabc123... \
  --secret 0xdef456... \
  --token USDC

```

## Pay (HTTP 402)

Bridge funds to the server's address cross-chain, then settle via x402 using Train's EIP-3009 integration. The HTLC secret is encoded as the EIP-3009 nonce/signature, so the facilitator settles with a standard `transferWithAuthorization` call.

```bash
ows-train pay <url> \
  -w <wallet-name> \
  --source-chain <chain>
```

### Pay Options

| Flag | Short | Description | Required |
|------|-------|-------------|----------|
| `<url>` | | URL to access | Yes |
| `--wallet` | `-w` | OWS wallet name | Yes |
| `--source-chain` | `-f` | Chain where your funds are | Yes |
| `--source-token` | | Token to pay with on source chain | No |
| `--api-url` | | Train API URL (default: Train Station) | No |
| `--source-rpc` | | Source chain RPC override | No |
| `--dest-rpc` | | Destination chain RPC override | No |
| `--method` | `-m` | HTTP method (default: GET) | No |
| `--header` | `-H` | HTTP header (repeatable) | No |
| `--data` | `-d` | Request body | No |

### Pay Flow

1. Fetch URL → detect HTTP 402 → parse `PAYMENT-REQUIRED` header (chain, token, amount, payTo)
2. Resolve token info from Train network metadata
3. Bridge funds from source chain to server's `payTo` address via Train HTLC
4. Build EIP-3009 `transferWithAuthorization` params from HTLC data (nonce = hash of hashlock+index, signature = ABI-encoded hashlock+index+secret+validity)
5. Send `PAYMENT-SIGNATURE` header → facilitator calls `transferWithAuthorization` on-chain → access granted

### Pay Examples

```bash
# Pay for a paywalled API — bridges ETH from Sepolia, pays USDC on Base Sepolia
ows-train pay https://www.x402.org/protected \
  -w agent-treasury \
  --source-chain sepolia \
  --source-token ETH

# Pay using a specific source token
ows-train pay https://api.example.com/premium \
  -w agent-treasury \
  --source-chain sepolia \
  --source-token ETH
```

### When to use `pay` vs `bridge`

| Scenario | Command |
|----------|---------|
| Move tokens between chains | `ows-train bridge` |
| Access a paywalled API/resource | `ows-train pay` |
| Pay for content on a different chain than your funds | `ows-train pay` (auto-bridges) |
| Recover funds from a failed bridge | `ows-train refund` |
| Manually claim solver funds with a known secret | `ows-train redeem` |

## Supported Networks & RPC URLs

| Chain | Name param | Public RPC (built-in fallback) |
|-------|-----------|-------------------------------|
| Sepolia | `sepolia` | `https://ethereum-sepolia-rpc.publicnode.com` |
| Arbitrum Sepolia | `arbitrum-sepolia` | `https://arbitrum-sepolia-rpc.publicnode.com` |
| Base Sepolia | `base-sepolia` | `https://base-sepolia-rpc.publicnode.com` |
| Starknet Sepolia | `starknet-sepolia` | `https://starknet-sepolia-rpc.publicnode.com` |
| Solana Devnet | `solana-devnet` | `https://api.devnet.solana.com` |
| Ethereum | `ethereum` | `https://ethereum-rpc.publicnode.com` |
| Arbitrum | `arbitrum` | `https://arbitrum-one-rpc.publicnode.com` |
| Base | `base` | `https://base-rpc.publicnode.com` |
| Starknet | `starknet` | `https://starknet-mainnet-rpc.publicnode.com` |
| Solana | `solana` | `https://api.mainnet-beta.solana.com` |

HTLC contract addresses and token metadata are fetched from the Train API at runtime — do NOT hardcode them.

## Prerequisites

1. An OWS wallet with funds on the source chain: `ows wallet create --name my-wallet`
2. The `ows-train` CLI installed: `npm install -g @open-wallet-standard/train`

## How It Works

Train Protocol uses HTLC (Hashed Time-Locked Contracts) for trustless cross-chain swaps:

1. **Get quote** from Train solvers for the bridge route
2. **Derive secret** by signing with OWS wallet (EIP-712 typed data) → deterministic master key → per-swap secret
3. **Lock funds** on source chain with hashlock + timelock
4. **Solver locks** on destination chain with same hashlock
5. **Reveal secret** to solver → solver claims source funds, user gets destination funds
6. If solver never locks → user **refunds** after timelock expires (`ows-train refund`)
7. If automatic flow stalls after solver locks → user **redeems** with the secret (`ows-train redeem`)

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Unknown chain "xxx"` | Use a supported chain name from the table above |
| `No quote available` / `Amount is less than min amount` | Increase the amount — solvers have minimums per route |
| `No HTLC contract address` | Chain may not be supported yet by Train |
| `Solver did not lock within timeout` | Retry, or use `ows-train refund` after timelock expires |
| `broadcast failed: insufficient funds` | Fund the wallet on the source chain first |
| `Token "xxx" not found on Y` | Check available tokens with `ows-train bridge --help` or use a contract address |
| `RefundNotAllowed` | Timelock hasn't expired yet — wait and retry later |
