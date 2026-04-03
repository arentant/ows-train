import { getWallet, signTypedData } from '@open-wallet-standard/core'
import { TrainApiClient, createHTLCClient } from '@train-protocol/sdk'
import { deriveKeyMaterial, IDENTITY_SALT } from '@train-protocol/auth'
import { registerEvmSdk, getEvmTypedData } from '@train-protocol/evm'
import { registerStarknetSdk } from '@train-protocol/starknet'
import { resolveNetwork, findToken, type ResolvedNetwork } from './network-resolver.js'
import { createOwsEvmSigner } from './signers/evm.js'

// Register chain SDKs (idempotent)
registerEvmSdk()
registerStarknetSdk()

export interface HTLCContext {
    network: ResolvedNetwork
    account: { address: string; chainId: string }
    client: ReturnType<typeof createHTLCClient>
    contractAddress: string
    rpcUrl: string
}

/**
 * Shared setup for any HTLC operation: resolve network, find wallet account,
 * create signer, and build an HTLC client ready to transact.
 */
export async function createHTLCContext(params: {
    wallet: string
    chain: string
    token: string
    trainApiUrl: string
    rpcUrl?: string
    passphrase?: string
}): Promise<HTLCContext & { tokenInfo: ReturnType<typeof findToken> }> {
    const { wallet, chain, token, trainApiUrl, rpcUrl, passphrase } = params

    const apiClient = new TrainApiClient({ baseUrl: trainApiUrl })
    const network = await resolveNetwork(chain, apiClient)
    const tokenInfo = findToken(network, token)

    const contractAddress = network.trainContract
    if (!contractAddress) {
        throw new Error(`No HTLC contract address for ${network.displayName}`)
    }

    const effectiveRpc = rpcUrl ?? network.rpcUrl
    if (!effectiveRpc) {
        throw new Error(`No RPC URL available for ${network.displayName}. Provide rpcUrl.`)
    }

    const walletInfo = getWallet(wallet)
    const account = walletInfo.accounts.find(a =>
        a.chainId.startsWith(network.namespace + ':')
    )
    if (!account) {
        throw new Error(`Wallet "${wallet}" has no account for ${network.owsChain}`)
    }

    const signer = createSigner(network, {
        wallet,
        chain: network.owsChain,
        passphrase,
        rpcUrl: effectiveRpc,
        address: account.address,
    })

    const client = createHTLCClient(network.namespace, {
        rpcUrl: effectiveRpc,
        signer,
    })

    return { network, account, client, contractAddress, rpcUrl: effectiveRpc, tokenInfo }
}

/**
 * Create a chain-appropriate signer from an OWS wallet.
 */
export function createSigner(
    network: ResolvedNetwork,
    config: { wallet: string; chain: string; passphrase?: string; rpcUrl?: string; address: string },
) {
    switch (network.namespace) {
        case 'eip155': {
            const chainId = parseInt(network.caip2Id.split(':')[1], 10)
            return createOwsEvmSigner({
                wallet: config.wallet,
                chain: config.chain,
                passphrase: config.passphrase,
                rpcUrl: config.rpcUrl,
                address: config.address,
                chainId,
            })
        }
        default:
            throw new Error(`Unsupported chain namespace: ${network.namespace}`)
    }
}

/**
 * Derive the Train master key by signing EIP-712 typed data with the OWS wallet.
 */
export function deriveInitialKeyFromOws(wallet: string, sandbox: boolean, passphrase?: string): Uint8Array {
    const typedData = getEvmTypedData(sandbox)
    const typedDataJson = JSON.stringify({
        types: typedData.types,
        primaryType: typedData.primaryType,
        domain: typedData.domain,
        message: typedData.message,
    })

    const chain = sandbox ? 'eip155:11155111' : 'eip155:1'
    const result = signTypedData(wallet, chain, typedDataJson, passphrase)

    const sigHex = result.signature.startsWith('0x') ? result.signature.slice(2) : result.signature
    const sigBytes = new Uint8Array(sigHex.length / 2)
    for (let i = 0; i < sigHex.length; i += 2) {
        sigBytes[i / 2] = parseInt(sigHex.substring(i, i + 2), 16)
    }

    const identitySalt = new TextEncoder().encode(IDENTITY_SALT)
    return new Uint8Array(deriveKeyMaterial(sigBytes, identitySalt))
}

/**
 * Poll until a condition returns a truthy value, or timeout.
 */
export async function poll<T>(
    fn: () => Promise<T | null | undefined>,
    timeout: number,
    interval: number,
): Promise<T | null> {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
        try {
            const result = await fn()
            if (result) return result
        } catch {
            // not ready yet
        }
        await sleep(interval)
    }
    return null
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}
