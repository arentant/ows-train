import { signAndSend } from '@open-wallet-standard/core'
import {
    createPublicClient,
    http,
    toRlp,
    type Hex,
} from 'viem'
import type { OwsSignerConfig } from '../types.js'

/** RLP-canonical hex: 0 → '0x', non-zero → minimal hex (no leading zeros) */
function rlpHex(value: bigint | number): Hex {
    const n = BigInt(value)
    if (n === 0n) return '0x' as Hex
    const hex = n.toString(16)
    return `0x${hex}` as Hex
}

/**
 * EVM signer adapter that bridges Train's EvmSigner interface to OWS wallet signing.
 *
 * Train's EVM HTLC client calls `sendTransaction({ to, data, value?, chainId? })`.
 * OWS's `signAndSend` expects a full unsigned EIP-1559 transaction (RLP-encoded hex).
 * This adapter builds the unsigned tx (fetching nonce + gas from RPC) and delegates
 * signing + broadcasting to OWS.
 */
export function createOwsEvmSigner(config: OwsSignerConfig & { address: string; chainId?: number }) {
    const { wallet, passphrase, index, address, chainId } = config
    const rpcUrl = config.rpcUrl

    return {
        address,

        async sendTransaction(tx: {
            to: string
            data: string
            value?: bigint
            chainId?: number
        }): Promise<string> {
            const effectiveChainId = tx.chainId ?? chainId ?? 1
            const effectiveRpcUrl = rpcUrl

            if (!effectiveRpcUrl) {
                throw new Error('OwsEvmSigner: rpcUrl is required for transaction building')
            }

            const client = createPublicClient({ transport: http(effectiveRpcUrl) })

            // Fetch nonce, gas estimate, and fee data in parallel
            const [nonce, feeData, gasEstimate] = await Promise.all([
                client.getTransactionCount({ address: address as Hex }),
                client.estimateFeesPerGas(),
                client.estimateGas({
                    account: address as Hex,
                    to: tx.to as Hex,
                    data: tx.data as Hex,
                    value: tx.value ?? 0n,
                }),
            ])

            // Build unsigned EIP-1559 transaction as RLP
            // Format: 0x02 || rlp([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data, accessList])
            const unsignedTxRlp = toRlp([
                rlpHex(effectiveChainId),
                rlpHex(nonce),
                rlpHex(feeData.maxPriorityFeePerGas!),
                rlpHex(feeData.maxFeePerGas!),
                rlpHex(gasEstimate),
                tx.to as Hex,
                rlpHex(tx.value ?? 0n),
                tx.data as Hex,
                [], // accessList
            ])

            // Prepend EIP-1559 type byte (0x02)
            const typedTx = ('0x02' + unsignedTxRlp.slice(2)) as Hex

            const result = signAndSend(
                wallet,
                `eip155:${effectiveChainId}`,
                typedTx.slice(2), // OWS expects hex without 0x prefix
                passphrase,
                index,
                effectiveRpcUrl,
            )

            return result.txHash
        },
    }
}
