import { createHTLCContext } from './htlc.js'
import type { RefundParams, RefundResult } from './types.js'

/**
 * Refund a user lock (or solver lock) after the timelock has expired.
 */
export async function refund(params: RefundParams): Promise<RefundResult> {
    const { hashlock, index } = params

    const { network, client, contractAddress, tokenInfo } = await createHTLCContext(params)

    const txHash = await client.refund({
        chainId: network.caip2Id.split(':')[1],
        contractAddress,
        id: hashlock,
        hashlock,
        sourceAsset: tokenInfo,
        index,
    })

    return { txHash, hashlock, chain: network.displayName }
}
