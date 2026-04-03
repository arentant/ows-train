/** Parsed MPP payment challenge from WWW-Authenticate header */
export interface MPPPaymentRequired {
    /** HMAC-bound challenge identifier */
    id: string
    /** Domain/service identifier */
    realm: string
    /** Payment method (e.g. "tempo", "stripe", "lightning") */
    method: string
    /** Billing pattern: "charge" (one-time), "session" (pay-as-you-go), "authorize" (subscription) */
    intent: string
    /** Decoded payment request details */
    request: MPPPaymentRequest
}

/** Method-specific payment request (decoded from base64url `request` field) */
export interface MPPPaymentRequest {
    /** Amount in base units */
    amount: string
    /** Token/currency identifier or contract address */
    currency: string
    /** Recipient address */
    recipient: string
    /** Token decimals */
    decimals?: number
    /** Chain ID (numeric) */
    chainId?: number
}

/** Authorization credential sent back in the retry request */
export interface MPPPaymentCredential {
    /** Challenge ID echoed back */
    id: string
    /** Payment method used */
    method: string
    /** Proof of payment */
    proof: {
        /** Transaction hash from on-chain settlement */
        txHash: string
        /** Timestamp of payment */
        timestamp: number
    }
}

/** Decoded Payment-Receipt header from successful 200 response */
export interface MPPPaymentReceipt {
    id: string
    status: string
    method: string
    timestamp: number
    paymentReference?: string
    amount: string
    currency: string
    payer?: string
}
