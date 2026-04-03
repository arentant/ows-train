import type { MPPPaymentRequired, MPPPaymentCredential } from './types.js'
import type { PaymentHeaders } from '../../pay-types.js'

interface CreateMPPPaymentParams {
    /** Parsed MPP 402 challenge */
    paymentRequired: MPPPaymentRequired
    /** Transaction hash proving on-chain payment/transfer */
    txHash: string
}

/**
 * Create MPP payment headers for the retry request.
 *
 * MPP uses proof-of-payment (tx hash) rather than cryptographic signing.
 * The Train bridge destination tx hash serves as the proof when bridging
 * funds to the recipient address.
 */
export function createMPPPaymentHeaders(params: CreateMPPPaymentParams): PaymentHeaders {
    const { paymentRequired, txHash } = params

    const credential: MPPPaymentCredential = {
        id: paymentRequired.id,
        method: paymentRequired.method,
        proof: {
            txHash,
            timestamp: Math.floor(Date.now() / 1000),
        },
    }

    const encoded = Buffer.from(JSON.stringify(credential)).toString('base64url')
    return { 'Authorization': `Payment ${encoded}` }
}
