import type { BridgeResult } from './types.js'

/** Detected payment protocol */
export type PaymentProtocol = 'x402' | 'mpp'

/** Normalized payment requirements extracted from a 402 response */
export interface PaymentRequirements {
    /** Which protocol issued the 402 */
    protocol: PaymentProtocol
    /** CAIP-2 network identifier (e.g. "eip155:8453") */
    network: string
    /** Amount in base units (e.g. "10000" for 0.01 USDC) */
    amount: string
    /** Token/asset contract address */
    asset: string
    /** Recipient address to pay */
    recipient: string
    /** Token decimals */
    decimals?: number
    /** Raw protocol-specific data for constructing payment */
    raw: unknown
}

/** Configuration for the pay flow (bridge + ows pay) */
export interface PaymentConfig {
    /** OWS wallet name */
    wallet: string
    /** OWS passphrase */
    passphrase?: string
    /** Train API URL */
    trainApiUrl: string
    /** Source chain to bridge from (e.g. "sepolia", "ethereum") */
    sourceChain: string
    /** Source token symbol to pay with (e.g. "ETH"). Defaults to destination token. */
    sourceToken?: string
    /** Source chain RPC URL */
    sourceRpcUrl?: string
    /** Destination chain RPC URL (for the payment chain) */
    destinationRpcUrl?: string
    /** HTTP method for the final ows pay request */
    method?: string
    /** HTTP headers for the final ows pay request */
    headers?: Record<string, string>
    /** Request body for the final ows pay request */
    body?: string
    /** Progress callback */
    onProgress?: (message: string) => void
}

/** Headers to attach to the retry request */
export type PaymentHeaders = Record<string, string>

/** Result of a payAndAccess call */
export interface PaymentResult {
    /** Whether the payment succeeded */
    success: boolean
    /** Output from ows pay request */
    output: string
    /** Which protocol was detected */
    protocol: PaymentProtocol
    /** Bridge result if cross-chain bridging was needed */
    bridgeResult?: BridgeResult
    /** Parsed payment requirements from the 402 response */
    requirements: PaymentRequirements
}
