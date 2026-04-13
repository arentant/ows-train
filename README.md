# ows-train

Trustless cross-chain token bridge and HTTP 402 payment CLI. Uses [Train Protocol](https://train.tech) HTLC atomic swaps with [OWS](https://openwallet.sh/) wallets for signing — no custodians, no intermediaries.

Train's HTLC contract natively supports EIP-3009 `transferWithAuthorization`, enabling cross-chain x402 payments without a separate settlement step.

## Setup

Requires Node.js >= 20 and the [OWS CLI](https://github.com/open-wallet-standard/core).

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
ows-train pay        Bridge funds cross-chain and pay x402/MPP paywalls
```

Run `ows-train <command> --help` for options. The `--api-url` flag defaults to the Train Station solver.

## Examples

```bash
# Bridge 0.005 ETH from Sepolia to Base Sepolia
ows-train bridge -w agent-treasury -f sepolia -t base-sepolia \
  --token ETH -a 0.005

# Pay an x402 paywalled API — bridges ETH from Sepolia, pays USDC on Base Sepolia
ows-train pay https://www.x402.org/protected \
  -w agent-treasury --source-chain sepolia --source-token ETH

# Bridge ETH to USDC cross-chain (receive exact amount)
ows-train bridge -w agent-treasury -f sepolia -t base-sepolia \
  --token ETH --dest-token USDC -r 10
```

## How x402 Payment Works

1. `ows-train pay` fetches the URL → receives HTTP 402 with `PAYMENT-REQUIRED` header
2. Parses payment requirements (chain, token, amount, payTo address)
3. Bridges funds via Train HTLC to the server's `payTo` address
4. Encodes the HTLC secret as EIP-3009 params: `nonce = keccak256(hashlock, index)`, `signature = abi.encode(hashlock, index, secret, validAfter, validBefore)`
5. Sends `PAYMENT-SIGNATURE` header → facilitator calls `transferWithAuthorization` on-chain → access granted

## License

MIT
