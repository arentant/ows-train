import type { MPPPaymentRequired, MPPPaymentRequest, MPPPaymentReceipt } from './types.js'
import type { PaymentRequirements } from '../../pay-types.js'

/**
 * Detect whether an HTTP response is an MPP payment challenge.
 * Checks for `WWW-Authenticate: Payment ...` header.
 */
export function isMPPResponse(status: number, headers: Record<string, string>): boolean {
    if (status !== 402) return false
    const wwwAuth = headers['www-authenticate'] ?? ''
    return wwwAuth.startsWith('Payment ')
}

/**
 * Parse the WWW-Authenticate header into structured MPP payment requirements.
 *
 * Format: `Payment id="...", realm="...", method="...", intent="...", request="<base64url>"`
 */
export function parseMPPResponse(wwwAuthHeader: string): MPPPaymentRequired {
    // Strip "Payment " prefix
    const params = wwwAuthHeader.slice('Payment '.length)

    const id = extractParam(params, 'id')
    const realm = extractParam(params, 'realm')
    const method = extractParam(params, 'method')
    const intent = extractParam(params, 'intent')
    const requestB64 = extractParam(params, 'request')

    if (!id || !method || !requestB64) {
        throw new Error('Invalid MPP WWW-Authenticate header: missing required fields')
    }

    // Decode base64url request payload
    const requestJson = Buffer.from(requestB64, 'base64url').toString('utf-8')
    const request: MPPPaymentRequest = JSON.parse(requestJson)

    return {
        id,
        realm: realm ?? '',
        method,
        intent: intent ?? 'charge',
        request,
    }
}

/**
 * Convert MPP payment requirements to unified PaymentRequirements.
 */
export function mppToPaymentRequirements(parsed: MPPPaymentRequired): PaymentRequirements {
    const { request } = parsed
    // Build CAIP-2 from chainId if available
    const network = request.chainId ? `eip155:${request.chainId}` : ''

    return {
        protocol: 'mpp',
        network,
        amount: request.amount,
        asset: request.currency,
        recipient: request.recipient,
        decimals: request.decimals,
        raw: parsed,
    }
}

/**
 * Decode the Payment-Receipt header from a successful 200 response.
 */
export function decodeMPPReceipt(header: string): MPPPaymentReceipt {
    const decoded = JSON.parse(Buffer.from(header, 'base64url').toString('utf-8'))
    return decoded as MPPPaymentReceipt
}

/** Extract a named parameter from a key="value" formatted string */
function extractParam(params: string, name: string): string | undefined {
    const regex = new RegExp(`${name}="([^"]*)"`)
    const match = params.match(regex)
    return match?.[1]
}
