import { isX402Response, parseX402Response, x402ToPaymentRequirements } from './402/x402/parser.js'
import { isMPPResponse, parseMPPResponse, mppToPaymentRequirements } from './402/mpp/parser.js'
import { createMPPPaymentHeaders } from './402/mpp/payment.js'
import { bridge } from './bridge.js'
import { resolveNetwork } from './network-resolver.js'
import { TrainApiClient, formatUnits } from '@train-protocol/sdk'
import { keccak256, encodeAbiParameters, pad, type Hex } from 'viem'
import type { PaymentRequirements, PaymentConfig, PaymentResult } from './pay-types.js'
import type { MPPPaymentRequired } from './402/mpp/types.js'

/**
 * Parse an HTTP 402 response and return unified payment requirements.
 * Auto-detects x402 vs MPP protocol.
 */
export async function parsePaymentRequired(response: Response): Promise<PaymentRequirements> {
    if (response.status !== 402) {
        throw new Error(`Expected HTTP 402, got ${response.status}`)
    }

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
    })

    if (isMPPResponse(response.status, headers)) {
        const wwwAuth = headers['www-authenticate']
        const parsed = parseMPPResponse(wwwAuth)
        return mppToPaymentRequirements(parsed)
    }

    const body = await response.json()
    if (isX402Response(response.status, headers, body)) {
        const parsed = parseX402Response(body, headers)
        return x402ToPaymentRequirements(parsed)
    }

    throw new Error('HTTP 402 response does not match x402 or MPP protocol')
}

/**
 * Look up a token's symbol and decimals from Train network metadata.
 */
async function resolveAsset(
    network: string,
    asset: string,
    apiClient: TrainApiClient,
): Promise<{ symbol: string; decimals: number }> {
    const resolved = await resolveNetwork(network, apiClient)
    const lower = asset.toLowerCase()
    const token = resolved.tokens.find(
        t => t.contract.toLowerCase() === lower || t.symbol.toLowerCase() === lower,
    )
    if (token) {
        return { symbol: token.symbol, decimals: token.decimals }
    }
    throw new Error(
        `Token "${asset}" not found on ${resolved.displayName}. Available: ${resolved.tokens.map(t => `${t.symbol} (${t.contract})`).join(', ')}`,
    )
}

/**
 * Full flow: fetch URL → detect 402 → bridge via Train → build x402 payment → retry.
 *
 * The Train HTLC contract supports EIP-3009 transferWithAuthorization natively.
 * After bridging, the HTLC params (hashlock, index, secret) are encoded as the
 * EIP-3009 nonce and signature, so the facilitator can call transferWithAuthorization
 * on the token contract to settle — no custom logic needed on the server side.
 */
export async function payAndAccess(
    url: string,
    config: PaymentConfig,
): Promise<PaymentResult> {
    const log = (msg: string) => config.onProgress?.(msg)

    // 1. Initial request
    log(`Requesting ${url}...`)
    const initialResponse = await fetch(url, {
        method: config.method ?? 'GET',
        headers: config.headers,
        body: config.body,
    })

    if (initialResponse.status !== 402) {
        return {
            success: true,
            output: await initialResponse.text(),
            protocol: 'x402',
            requirements: { protocol: 'x402', network: '', amount: '0', asset: '', recipient: '', raw: null },
        }
    }

    // 2. Parse 402 requirements
    log('Received HTTP 402 — parsing payment requirements...')
    const requirements = await parsePaymentRequired(initialResponse)
    log(`Payment required: ${requirements.protocol.toUpperCase()} — ${requirements.amount} on ${requirements.network} to ${requirements.recipient}`)

    // 3. Resolve token
    const apiClient = new TrainApiClient({ baseUrl: config.trainApiUrl })
    const { symbol: destTokenSymbol, decimals } = await resolveAsset(
        requirements.network,
        requirements.asset,
        apiClient,
    )
    const sourceTokenSymbol = config.sourceToken ?? destTokenSymbol
    const humanAmount = formatUnits(BigInt(requirements.amount), decimals)

    log(`Bridging ${humanAmount} ${sourceTokenSymbol} → ${destTokenSymbol} to ${requirements.recipient}...`)

    // 4. Bridge funds to server's payTo address via Train
    const bridgeResult = await bridge({
        wallet: config.wallet,
        sourceChain: config.sourceChain,
        destinationChain: requirements.network,
        token: sourceTokenSymbol,
        destinationToken: destTokenSymbol,
        receiveAmount: humanAmount,
        destinationAddress: requirements.recipient,
        passphrase: config.passphrase,
        trainApiUrl: config.trainApiUrl,
        sourceRpcUrl: config.sourceRpcUrl,
        destinationRpcUrl: config.destinationRpcUrl,
        includeReward: false,
        onProgress: (event) => log(`[bridge] ${event.message}`),
    })

    if (bridgeResult.status === 'error' || bridgeResult.status === 'pending_solver') {
        throw new Error(`Bridge failed: ${bridgeResult.error}`)
    }

    // 5. Build payment headers
    let paymentHeaders: Record<string, string>

    if (requirements.protocol === 'x402' && bridgeResult.secret && bridgeResult.trainContract) {
        // Build EIP-3009 transferWithAuthorization params from HTLC data
        // The Train contract supports this natively — nonce and signature are HTLC-derived
        paymentHeaders = buildTrainX402Headers(
            requirements,
            bridgeResult.trainContract,
            bridgeResult.hashlock,
            1, // solver lock index
            bridgeResult.secret,
        )
        log('Built PAYMENT-SIGNATURE with Train EIP-3009 authorization')
    } else if (requirements.protocol === 'mpp') {
        const mppRequired = requirements.raw as MPPPaymentRequired
        const txHash = bridgeResult.destinationTxHash ?? bridgeResult.sourceTxHash
        paymentHeaders = createMPPPaymentHeaders({ paymentRequired: mppRequired, txHash })
        log('Built MPP payment headers')
    } else {
        throw new Error('Bridge completed but missing secret or trainContract for payment')
    }

    // 6. Retry with payment header
    log('Retrying request with payment...')
    const retryResponse = await fetch(url, {
        method: config.method ?? 'GET',
        headers: {
            ...config.headers,
            ...paymentHeaders,
        },
        body: config.body,
    })

    const output = await retryResponse.text()

    return {
        success: retryResponse.ok,
        output,
        protocol: requirements.protocol,
        bridgeResult,
        requirements,
    }
}

/**
 * Build x402 PAYMENT-SIGNATURE header using Train's EIP-3009 integration.
 *
 * The Train HTLC contract implements EIP-3009 transferWithAuthorization where:
 *   nonce     = keccak256(abi.encode(hashlock, index))
 *   signature = abi.encode(hashlock, index, secret, validAfter, validBefore)
 *   from      = Train contract address (holds the locked funds)
 *
 * The facilitator calls transferWithAuthorization as normal — it doesn't
 * need to know about Train or HTLCs.
 */
function buildTrainX402Headers(
    requirements: PaymentRequirements,
    trainContract: string,
    hashlock: string,
    index: number,
    secret: string,
): Record<string, string> {
    const hashlockBytes32 = pad(hashlock as Hex, { size: 32 })
    const secretBigInt = BigInt(pad(secret as Hex, { size: 32 }))
    const indexBigInt = BigInt(index)

    const raw = requirements.raw as { accepts?: Array<Record<string, unknown>> }
    const accepted = raw?.accepts?.[0] ?? {}
    const maxTimeout = (accepted as any).maxTimeoutSeconds ?? 300

    const now = Math.floor(Date.now() / 1000)
    const validAfter = BigInt(now - 10)
    const validBefore = BigInt(now + maxTimeout)

    // nonce = keccak256(abi.encode(hashlock, index))
    const nonce = keccak256(
        encodeAbiParameters(
            [{ type: 'bytes32' }, { type: 'uint256' }],
            [hashlockBytes32, indexBigInt],
        ),
    )

    // signature = abi.encode(hashlock, index, secret, validAfter, validBefore)
    const signature = encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
        [hashlockBytes32, indexBigInt, secretBigInt, validAfter, validBefore],
    )

    const payload = {
        x402Version: 2,
        resource: (raw as any)?.resource,
        accepted,
        payload: {
            signature,
            authorization: {
                from: trainContract,
                to: requirements.recipient,
                value: requirements.amount,
                validAfter: validAfter.toString(),
                validBefore: validBefore.toString(),
                nonce,
            },
        },
    }

    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64')
    return {
        'X-PAYMENT': encoded,
        'PAYMENT-SIGNATURE': encoded,
    }
}
