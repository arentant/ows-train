export interface BridgeParams {
    /** OWS wallet name or ID */
    wallet: string
    /** Source chain name (e.g. "ethereum", "base", "arbitrum") */
    sourceChain: string
    /** Destination chain name (e.g. "solana", "ethereum") */
    destinationChain: string
    /** Token symbol (e.g. "USDC", "ETH") */
    token: string
    /** Amount to lock on source chain (human-readable). Provide this OR receiveAmount, not both. */
    amount?: string
    /** Amount to receive on destination chain (human-readable). Solver calculates required source amount. */
    receiveAmount?: string
    /** OWS passphrase or API key token */
    passphrase?: string
    /** Train Station API base URL */
    trainApiUrl: string
    /** Source chain RPC URL (if not provided, uses Train network defaults) */
    sourceRpcUrl?: string
    /** Destination chain RPC URL (if not provided, uses Train network defaults) */
    destinationRpcUrl?: string
    /** Custom destination address (defaults to wallet's own address on dest chain) */
    destinationAddress?: string
    /** Destination token symbol (defaults to same as source token) */
    destinationToken?: string
    /** Max time (ms) to wait for solver lock before aborting. Default: 120000 */
    solverTimeout?: number
    /** Polling interval (ms) for solver lock checks. Default: 5000 */
    pollInterval?: number
    /** Whether to include solver reward in quote. Default: true */
    includeReward?: boolean
    /** Progress callback for live status updates */
    onProgress?: (event: BridgeProgressEvent) => void
}

export type BridgeStep =
    | 'resolving_networks'
    | 'fetching_quote'
    | 'locking_funds'
    | 'waiting_solver'
    | 'verifying_solver'
    | 'revealing_secret'
    | 'waiting_completion'
    | 'done'

export interface BridgeProgressEvent {
    step: BridgeStep
    message: string
    data?: Record<string, unknown>
}

export interface BridgeResult {
    hashlock: string
    /** HTLC secret (preimage). Available when bridge completes successfully. */
    secret?: string
    /** HTLC contract address on destination chain */
    trainContract?: string
    sourceTxHash: string
    status: BridgeStatus
    receiveAmount: string
    solverId: string
    destinationTxHash?: string
    error?: string
}

export type BridgeStatus =
    | 'completed'
    | 'pending_solver'
    | 'secret_revealed'
    | 'refunded'
    | 'error'

export interface RefundParams {
    /** OWS wallet name or ID */
    wallet: string
    /** Chain where funds are locked (e.g. "sepolia", "base-sepolia") */
    chain: string
    /** HTLC hashlock to refund */
    hashlock: string
    /** Token symbol locked in the HTLC */
    token: string
    /** Train Station API base URL */
    trainApiUrl: string
    /** RPC URL override */
    rpcUrl?: string
    /** OWS passphrase or API key token */
    passphrase?: string
    /** Solver lock index — omit for user refund, provide for solver refund */
    index?: number
}

export interface RefundResult {
    txHash: string
    hashlock: string
    chain: string
}

export interface RedeemParams {
    /** OWS wallet name or ID */
    wallet: string
    /** Chain where solver locked funds (destination chain) */
    chain: string
    /** HTLC hashlock */
    hashlock: string
    /** HTLC secret (preimage) */
    secret: string
    /** Token symbol on this chain */
    token: string
    /** Train Station API base URL */
    trainApiUrl: string
    /** RPC URL override */
    rpcUrl?: string
    /** OWS passphrase or API key token */
    passphrase?: string
    /** Solver lock index (default: 0) */
    index?: number
}

export interface RedeemResult {
    txHash: string
    hashlock: string
    chain: string
}

export interface OwsSignerConfig {
    wallet: string
    chain: string
    passphrase?: string
    rpcUrl?: string
    index?: number
}
