# ows-train

Trustless cross-chain token bridge and x402 payment CLI. Uses [Train Protocol](https://train.tech) HTLC atomic swaps with [OWS](https://github.com/open-wallet-standard) wallets for signing — no custodians, no intermediaries.

## Setup

Requires Node.js >= 20 and the [OWS CLI](https://github.com/open-wallet-standard).

```bash
npm install
npm run build
npm link
```

## Commands

```
ows-train bridge     Bridge tokens across chains
ows-train refund     Refund a locked HTLC after timelock expires
ows-train redeem     Redeem a solver lock using the HTLC secret
ows-train pay        Bridge funds then pay an HTTP 402 endpoint
```

Run `ows-train <command> --help` for options.

## Agent Prompt Example

```
You have an OWS wallet called "agent-treasury" with ETH on Sepolia.

When you encounter an HTTP 402 paywall and don't have funds on the
required chain, use ows-train pay to bridge and pay in one step:

  ows-train pay <url> -w agent-treasury --source-chain sepolia \
    --api-url https://train-solver-station.lb.layerswap.io

To move tokens between chains directly:

  ows-train bridge -w agent-treasury -f sepolia -t base-sepolia \
    --token ETH -a 0.005 \
    --api-url https://train-solver-station.lb.layerswap.io
```

## License

MIT
