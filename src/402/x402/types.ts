/** A single payment option from the x402 402 response */
export interface X402PaymentOption {
    scheme: string
    network: string
    /** v2 uses `amount`, v1 used `maxAmountRequired` */
    amount?: string
    maxAmountRequired?: string
    payTo: string
    asset: string
    maxTimeoutSeconds?: number
    extra?: {
        assetTransferMethod?: 'eip3009' | 'permit2'
        name?: string
        version?: string
        feePayer?: string
    }
}

/** Parsed x402 402 response body / PAYMENT-REQUIRED header */
export interface X402PaymentRequired {
    x402Version: number
    accepts: X402PaymentOption[]
    error?: string
    resource?: {
        url?: string
        description?: string
        mimeType?: string
    }
}

/** EIP-3009 authorization fields */
export interface EIP3009Authorization {
    from: string
    to: string
    value: string
    validAfter: string
    validBefore: string
    nonce: string
}

/** Signed x402 payment payload for PAYMENT-SIGNATURE header (v2) */
export interface X402PaymentPayload {
    x402Version: number
    scheme: string
    network: string
    payload: {
        signature: string
        authorization: EIP3009Authorization
        /** Raw calldata for on-chain settlement — facilitator submits this tx */
        calldata?: {
            to: string
            data: string
            value?: string
            chainId: string
        }
    }
}

/** Decoded PAYMENT-RESPONSE header from successful 200 (v2) */
export interface X402PaymentResponse {
    success: boolean
    transaction?: string
    network?: string
    payer?: string
    errorReason?: string | null
}
