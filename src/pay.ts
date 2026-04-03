import { execFileSync } from 'node:child_process'
import { isX402Response, parseX402Response, x402ToPaymentRequirements } from './402/x402/parser.js'
import { isMPPResponse, parseMPPResponse, mppToPaymentRequirements } from './402/mpp/parser.js'
import { bridge } from './bridge.js'
import { resolveNetwork } from './network-resolver.js'
import { TrainApiClient, formatUnits } from '@train-protocol/sdk'
import type { PaymentRequirements, PaymentConfig, PaymentResult } from './pay-types.js'

/**
 * Parse an HTTP 402 response and return unified payment requirements.
 * Auto-detects x402 vs MPP protocol.
 */
export async function parsePaymentRequired(response: Response): Promise<PaymentRequirements> {
    if (response.status !== 402) {
        throw new Error(`Expected HTTP 402, got ${response.status}`)
    }

    // Normalize headers to lowercase
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
    })

    // Try MPP first (header-based detection is cheaper than parsing body)
    if (isMPPResponse(response.status, headers)) {
        const wwwAuth = headers['www-authenticate']
        const parsed = parseMPPResponse(wwwAuth)
        return mppToPaymentRequirements(parsed)
    }

    // Try x402 — v2 header-based or v1 body-based detection
    const body = await response.json()
    if (isX402Response(response.status, headers, body)) {
        const parsed = parseX402Response(body, headers)
        return x402ToPaymentRequirements(parsed)
    }

    throw new Error('HTTP 402 response does not match x402 or MPP protocol')
}

/**
 * Look up a token's symbol and decimals from the Train network metadata.
 * Matches by contract address against the network's token list.
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
 * Full flow: fetch URL → detect 402 → bridge funds → ows pay request.
 *
 * 1. Fetches the URL and checks for HTTP 402.
 * 2. Parses payment requirements (chain, token, amount).
 * 3. Resolves token symbol and decimals from Train network metadata.
 * 4. Bridges funds from the source chain to the wallet's own address on the payment chain.
 * 5. Calls `ows pay request` to handle the actual payment protocol (x402/MPP).
 */
export async function payAndAccess(
    url: string,
    config: PaymentConfig,
): Promise<PaymentResult> {
    const log = (msg: string) => config.onProgress?.(msg)

    // 1. Initial request to detect 402
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

    // 3. Resolve token from Train network metadata
    const apiClient = new TrainApiClient({ baseUrl: config.trainApiUrl })
    const { symbol: destTokenSymbol, decimals } = await resolveAsset(
        requirements.network,
        requirements.asset,
        apiClient,
    )
    const sourceTokenSymbol = config.sourceToken ?? destTokenSymbol
    const humanAmount = formatUnits(BigInt(requirements.amount), decimals)

    log(`Bridging ${humanAmount} ${sourceTokenSymbol} → ${destTokenSymbol} to payment chain...`)

    // 4. Bridge funds to own wallet on the payment chain
    const bridgeResult = await bridge({
        wallet: config.wallet,
        sourceChain: config.sourceChain,
        destinationChain: requirements.network,
        token: sourceTokenSymbol,
        destinationToken: destTokenSymbol,
        receiveAmount: humanAmount,
        passphrase: config.passphrase,
        trainApiUrl: config.trainApiUrl,
        sourceRpcUrl: config.sourceRpcUrl,
        destinationRpcUrl: config.destinationRpcUrl,
        onProgress: (event) => log(`[bridge] ${event.message}`),
    })

    if (bridgeResult.status === 'error' || bridgeResult.status === 'pending_solver') {
        throw new Error(`Bridge failed: ${bridgeResult.error}`)
    }

    log('Bridge complete. Calling ows pay...')

    // 5. Call `ows pay request` to handle the actual payment
    const owsPayArgs = ['pay', 'request', url, '--wallet', config.wallet]

    if (config.method && config.method !== 'GET') {
        owsPayArgs.push('--method', config.method)
    }
    if (config.body) {
        owsPayArgs.push('--body', config.body)
    }
    if (!config.passphrase) {
        owsPayArgs.push('--no-passphrase')
    }

    const env = { ...process.env }
    if (config.passphrase) {
        env.OWS_PASSPHRASE = config.passphrase
    }

    let output: string
    let success: boolean

    try {
        output = execFileSync('ows', owsPayArgs, {
            encoding: 'utf-8',
            env,
            timeout: 60_000,
        }).trim()
        success = true
    } catch (err: any) {
        output = (err.stdout ?? '') + (err.stderr ?? '')
        success = false
    }

    return {
        success,
        output,
        protocol: requirements.protocol,
        bridgeResult,
        requirements,
    }
}
