import type { X402PaymentRequired, X402PaymentResponse } from './types.js'
import type { PaymentRequirements } from '../../pay-types.js'

/**
 * Detect whether an HTTP response is an x402 payment challenge.
 * Supports both v1 (X-PAYMENT / body-based) and v2 (PAYMENT-REQUIRED header).
 */
export function isX402Response(status: number, headers: Record<string, string>, body?: unknown): boolean {
    if (status !== 402) return false
    // v2: PAYMENT-REQUIRED header
    if (headers['payment-required']) return true
    // v1 fallback: x402Version in body
    if (body && typeof body === 'object' && 'x402Version' in body) return true
    return false
}

/**
 * Parse an x402 402 response into structured payment requirements.
 * Supports v2 PAYMENT-REQUIRED header (base64 JSON) and v1 body-based format.
 */
export function parseX402Response(bodyOrHeader: unknown, headers?: Record<string, string>): X402PaymentRequired {
    // v2: parse from PAYMENT-REQUIRED header
    if (headers?.['payment-required']) {
        const decoded = JSON.parse(Buffer.from(headers['payment-required'], 'base64').toString('utf-8'))
        return validateX402Response(decoded)
    }
    // v1 fallback: parse from body
    return validateX402Response(bodyOrHeader)
}

function validateX402Response(data: unknown): X402PaymentRequired {
    const parsed = data as X402PaymentRequired
    if (!parsed?.x402Version || !Array.isArray(parsed.accepts) || parsed.accepts.length === 0) {
        throw new Error('Invalid x402 response: missing x402Version or accepts array')
    }
    return parsed
}

/**
 * Convert an x402 payment option to unified PaymentRequirements.
 * Selects the first (or best) payment option from accepts[].
 */
export function x402ToPaymentRequirements(parsed: X402PaymentRequired): PaymentRequirements {
    const option = parsed.accepts[0]
    return {
        protocol: 'x402',
        network: option.network,
        amount: option.amount ?? option.maxAmountRequired ?? '0',
        asset: option.asset,
        recipient: option.payTo,
        raw: parsed,
    }
}

/**
 * Decode the PAYMENT-RESPONSE header from a successful 200 response.
 * Also supports legacy X-PAYMENT-RESPONSE header.
 */
export function decodeX402PaymentResponse(header: string): X402PaymentResponse {
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'))
    return decoded as X402PaymentResponse
}
