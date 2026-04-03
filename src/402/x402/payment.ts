import { signTypedData } from '@open-wallet-standard/core'
import { randomBytes } from 'crypto'
import type { X402PaymentRequired, X402PaymentPayload, EIP3009Authorization } from './types.js'
import type { PaymentHeaders } from '../../pay-types.js'

/** EIP-712 types for EIP-3009 TransferWithAuthorization */
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
    TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
    ],
} as const

interface SignX402Params {
    /** Parsed x402 402 response */
    paymentRequired: X402PaymentRequired
    /** Index into accepts[] to pay (default: 0) */
    acceptIndex?: number
    /** OWS wallet name */
    wallet: string
    /** Signer's address on the payment chain */
    fromAddress: string
    /** OWS passphrase */
    passphrase?: string
    /** Raw calldata for on-chain settlement (e.g. HTLC redeem from Train bridge) */
    calldata?: {
        to: string
        data: string
        value?: string
        chainId: string
    }
}

/**
 * Create a signed x402 payment and return the headers to attach to the retry request.
 *
 * Signs an EIP-3009 TransferWithAuthorization via the OWS wallet,
 * then base64-encodes the payload for the PAYMENT-SIGNATURE header (v2).
 *
 * When `calldata` is provided, the facilitator can execute it on-chain
 * to settle the payment (e.g. redeem an HTLC from a Train bridge).
 */
export function createX402PaymentHeaders(params: SignX402Params): PaymentHeaders {
    const { paymentRequired, acceptIndex = 0, wallet, fromAddress, passphrase, calldata } = params
    const option = paymentRequired.accepts[acceptIndex]
    if (!option) {
        throw new Error(`No x402 payment option at index ${acceptIndex}`)
    }

    // Extract chain ID from CAIP-2 network (e.g. "eip155:8453" → 8453)
    const chainId = parseInt(option.network.split(':')[1], 10)
    if (isNaN(chainId)) {
        throw new Error(`Cannot parse chain ID from x402 network: ${option.network}`)
    }

    const now = Math.floor(Date.now() / 1000)
    const validAfter = (now - 10).toString()
    const validBefore = (now + (option.maxTimeoutSeconds ?? 120)).toString()
    const nonce = '0x' + randomBytes(32).toString('hex')

    const authorization: EIP3009Authorization = {
        from: fromAddress,
        to: option.payTo,
        value: option.amount ?? option.maxAmountRequired ?? '0',
        validAfter,
        validBefore,
        nonce,
    }

    // Build EIP-712 typed data
    const tokenName = option.extra?.name ?? 'USD Coin'
    const tokenVersion = option.extra?.version ?? '2'

    const typedData = {
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: 'TransferWithAuthorization',
        domain: {
            name: tokenName,
            version: tokenVersion,
            chainId,
            verifyingContract: option.asset,
        },
        message: authorization,
    }

    // Sign via OWS wallet
    const result = signTypedData(wallet, option.network, JSON.stringify(typedData), passphrase)

    const payload: X402PaymentPayload = {
        x402Version: 2,
        scheme: option.scheme,
        network: option.network,
        payload: {
            signature: result.signature,
            authorization,
            calldata,
        },
    }

    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64')
    return { 'PAYMENT-SIGNATURE': encoded }
}
