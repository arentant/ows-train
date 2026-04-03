import { createHTLCContext } from './htlc.js'
import type { RedeemParams, RedeemResult } from './types.js'

/**
 * Redeem a solver lock on the destination chain using the HTLC secret.
 */
export async function redeem(params: RedeemParams): Promise<RedeemResult> {
    const { hashlock, secret, index } = params

    const { network, account, client, contractAddress, tokenInfo } = await createHTLCContext(params)

    const txHash = await client.redeemSolver({
        chainId: network.caip2Id.split(':')[1],
        contractAddress,
        id: hashlock,
        secret,
        sourceAsset: tokenInfo,
        destinationAddress: account.address,
        destinationAsset: tokenInfo,
        index,
    })

    return { txHash, hashlock, chain: network.displayName }
}
