import { getWallet } from '@open-wallet-standard/core'
import {
    TrainApiClient,
    createHTLCClient,
    deriveSecretFromTimelock,
    secretToHashlock,
    parseUnits,
    formatUnits,
    verifySolverLock,
    bytesToHex,
} from '@train-protocol/sdk'
import { resolveNetwork, findToken } from './network-resolver.js'
import { createSigner, deriveInitialKeyFromOws, poll } from './htlc.js'
import type { BridgeParams, BridgeResult, BridgeProgressEvent } from './types.js'

const DEFAULT_SOLVER_TIMEOUT = 120_000
const DEFAULT_POLL_INTERVAL = 5_000

/**
 * Execute a cross-chain bridge via Train Protocol HTLC atomic swap.
 */
export async function bridge(params: BridgeParams): Promise<BridgeResult> {
    const {
        wallet,
        sourceChain,
        destinationChain,
        token,
        amount,
        receiveAmount,
        passphrase,
        trainApiUrl,
        sourceRpcUrl,
        destinationRpcUrl,
        destinationAddress: customDestAddress,
        destinationToken,
        solverTimeout = DEFAULT_SOLVER_TIMEOUT,
        pollInterval = DEFAULT_POLL_INTERVAL,
        onProgress,
    } = params

    if (!amount && !receiveAmount) {
        throw new Error('Either amount or receiveAmount must be provided')
    }
    if (amount && receiveAmount) {
        throw new Error('Provide either amount or receiveAmount, not both')
    }

    const emit = (event: BridgeProgressEvent) => onProgress?.(event)
    const apiClient = new TrainApiClient({ baseUrl: trainApiUrl })

    // 1. Resolve networks and tokens
    emit({ step: 'resolving_networks', message: `Resolving ${sourceChain} and ${destinationChain}...` })

    const [sourceNetwork, destNetwork] = await Promise.all([
        resolveNetwork(sourceChain, apiClient),
        resolveNetwork(destinationChain, apiClient),
    ])

    const sourceToken = findToken(sourceNetwork, token)
    const destToken = findToken(destNetwork, destinationToken ?? token)

    emit({
        step: 'resolving_networks',
        message: `Resolved: ${sourceNetwork.displayName} → ${destNetwork.displayName}`,
        data: { sourceNetwork: sourceNetwork.displayName, destNetwork: destNetwork.displayName },
    })

    // 2. Get wallet addresses from OWS
    const walletInfo = getWallet(wallet)
    const sourceAccount = walletInfo.accounts.find(a =>
        a.chainId.startsWith(sourceNetwork.namespace + ':')
    )
    const destAccount = walletInfo.accounts.find(a =>
        a.chainId.startsWith(destNetwork.namespace + ':')
    )
    if (!sourceAccount) {
        throw new Error(`Wallet "${wallet}" has no account for ${sourceNetwork.owsChain}`)
    }
    if (!destAccount && !customDestAddress) {
        throw new Error(`Wallet "${wallet}" has no account for ${destNetwork.owsChain}`)
    }

    // 3. Get quote
    emit({ step: 'fetching_quote', message: 'Fetching quote from solvers...' })

    const quoteParams: Parameters<typeof apiClient.getQuote>[0] = {
        sourceNetwork: sourceNetwork.caip2Id,
        sourceTokenContract: sourceToken.contract,
        destinationNetwork: destNetwork.caip2Id,
        destinationTokenContract: destToken.contract,
        includeReward: true,
    }

    if (amount) {
        quoteParams.amount = parseUnits(amount, sourceToken.decimals).toString()
    } else {
        quoteParams.receiveAmount = parseUnits(receiveAmount!, destToken.decimals).toString()
    }

    const quoteResponse = await apiClient.getQuote(quoteParams)
    const bestQuote = quoteResponse.quotes.find(q => q.isBest)?.quote
    if (!bestQuote) {
        const errors = quoteResponse.errors.map(e => `${e.solverId}: ${e.message}`).join('; ')
        throw new Error(`No quote available. Solver errors: ${errors || 'none'}`)
    }

    const solverId = quoteResponse.quotes.find(q => q.isBest)!.solver.id
    const receiveHuman = formatUnits(BigInt(bestQuote.receiveAmount), destToken.decimals)
    const feeHuman = formatUnits(BigInt(bestQuote.totalFee), sourceToken.decimals)
    const effectiveAmount = amount ?? formatUnits(BigInt((bestQuote as any).amount), sourceToken.decimals)

    emit({
        step: 'fetching_quote',
        message: receiveAmount
            ? `Quote: lock ${effectiveAmount} ${sourceToken.symbol} to receive ${receiveHuman} ${destToken.symbol} (fee: ${feeHuman} ${sourceToken.symbol})`
            : `Quote: receive ${receiveHuman} ${destToken.symbol} (fee: ${feeHuman} ${sourceToken.symbol})`,
        data: {
            solverId,
            receiveAmount: receiveHuman,
            amount: effectiveAmount,
            fee: feeHuman,
            sourceToken: sourceToken.symbol,
            destToken: destToken.symbol,
        },
    })

    // 4. Derive secret and hashlock
    const isSandbox = sourceNetwork.caip2Id.includes('11155111') || sourceNetwork.caip2Id.includes('421614')
    const initialKey = deriveInitialKeyFromOws(wallet, isSandbox, passphrase)
    const nonce = Date.now()
    const secret = deriveSecretFromTimelock(initialKey, nonce)
    const secretHex = bytesToHex(Array.from(secret))
    const hashlock = secretToHashlock(secretHex)

    // 5. Resolve RPCs
    const effectiveSourceRpc = sourceRpcUrl ?? sourceNetwork.rpcUrl
    const effectiveDestRpc = destinationRpcUrl ?? destNetwork.rpcUrl
    if (!effectiveSourceRpc) {
        throw new Error(`No RPC URL available for ${sourceNetwork.displayName}. Provide sourceRpcUrl.`)
    }

    // 6. Lock funds on source chain
    const lockAmount = amount ?? effectiveAmount
    emit({ step: 'locking_funds', message: `Locking ${lockAmount} ${token} on ${sourceNetwork.displayName}...` })

    const signer = createSigner(sourceNetwork, {
        wallet, chain: sourceNetwork.owsChain, passphrase, rpcUrl: effectiveSourceRpc, address: sourceAccount.address,
    })
    const sourceClient = createHTLCClient(sourceNetwork.namespace, { rpcUrl: effectiveSourceRpc, signer })

    const sourceContractAddress = sourceNetwork.trainContract
    if (!sourceContractAddress) {
        throw new Error(`No HTLC contract address for ${sourceNetwork.displayName}`)
    }

    const lockResult = await sourceClient.userLock({
        hashlock, nonce,
        amount: lockAmount, decimals: sourceToken.decimals,
        sourceChain: sourceNetwork.caip2Id, destinationChain: destNetwork.caip2Id,
        sourceAsset: sourceToken, destinationAsset: destToken.contract,
        destinationAmount: bestQuote.receiveAmount,
        sourceAddress: sourceAccount.address,
        destinationAddress: customDestAddress ?? destAccount!.address,
        destLpAddress: bestQuote.sourceSolverAddress,
        srcLpAddress: bestQuote.sourceSolverAddress,
        atomicContract: sourceContractAddress,
        quoteExpiry: bestQuote.quoteExpirationTimestampInSeconds,
        timelockDelta: bestQuote.timelockTimeSpanInSeconds,
        rewardAmount: bestQuote.reward?.amount,
        rewardToken: bestQuote.reward?.rewardToken,
        rewardRecipient: bestQuote.reward?.rewardRecipientAddress,
        rewardTimelockDelta: bestQuote.reward?.rewardTimelockTimeSpanInSeconds,
        solverData: bestQuote.signature,
    })

    emit({ step: 'locking_funds', message: `Locked! TX: ${lockResult.hash}`, data: { txHash: lockResult.hash, hashlock } })

    // 7. Wait for solver lock on destination chain
    const destContractAddress = destNetwork.trainContract
    if (!destContractAddress) {
        throw new Error(`No HTLC contract address for ${destNetwork.displayName}`)
    }

    emit({ step: 'waiting_solver', message: `Waiting for solver to lock on ${destNetwork.displayName}...` })

    const destClient = createHTLCClient(destNetwork.namespace, { rpcUrl: effectiveDestRpc ?? effectiveSourceRpc })
    const lockParams = {
        id: hashlock,
        chainId: destNetwork.caip2Id.split(':')[1],
        contractAddress: destContractAddress,
        decimals: destToken.decimals,
        solverAddress: bestQuote.destinationSolverAddress,
    }
    const destRpcUrls = effectiveDestRpc ? [effectiveDestRpc] : []

    const solverLock = await poll(
        () => destRpcUrls.length > 0
            ? destClient.getSolverLockDetailsWithConsensus(lockParams, destRpcUrls)
            : destClient.getSolverLockDetails(lockParams, ''),
        solverTimeout, pollInterval,
    )

    if (!solverLock) {
        emit({ step: 'waiting_solver', message: 'Solver timeout — did not lock in time' })
        return {
            hashlock, sourceTxHash: lockResult.hash, status: 'pending_solver',
            receiveAmount: bestQuote.receiveAmount, solverId,
            error: 'Solver did not lock within timeout. You can refund after timelock expires.',
        }
    }

    emit({ step: 'waiting_solver', message: 'Solver locked on destination chain' })

    // 8. Verify solver lock
    emit({ step: 'verifying_solver', message: 'Verifying solver lock details...' })

    const verification = verifySolverLock({
        solverLockDetails: solverLock,
        expectedReceiveAmount: solverLock.amount,
        expectedRecipient: customDestAddress ?? destAccount!.address,
        expectedToken: destToken.contract,
    })

    if (!verification.verified) {
        emit({ step: 'verifying_solver', message: `Verification failed: ${verification.mismatches.join(', ')}` })
        return {
            hashlock, sourceTxHash: lockResult.hash, status: 'error',
            receiveAmount: bestQuote.receiveAmount, solverId,
            error: `Solver lock verification failed: ${verification.mismatches.join(', ')}`,
        }
    }

    emit({ step: 'verifying_solver', message: 'Solver lock verified' })

    // 9. Reveal secret
    emit({ step: 'revealing_secret', message: 'Revealing secret to solver...' })
    await apiClient.revealSecret(solverId, hashlock, secretHex)
    emit({ step: 'revealing_secret', message: 'Secret revealed' })

    // 10. Wait for destination tx
    emit({ step: 'waiting_completion', message: 'Waiting for destination transaction...' })

    const destTxHash = await poll(async () => {
        const { order } = await apiClient.getOrder(solverId, hashlock)
        return order.transactions?.find(t => t.type === 'HTLCRedeem')?.hash ?? null
    }, solverTimeout, pollInterval)

    const status = destTxHash ? 'completed' : 'secret_revealed'

    emit({
        step: 'done',
        message: status === 'completed' ? 'Bridge completed!' : 'Secret revealed, awaiting finalization',
        data: { status, destinationTxHash: destTxHash },
    })

    return {
        hashlock, secret: secretHex, trainContract: destContractAddress,
        sourceTxHash: lockResult.hash, status,
        receiveAmount: bestQuote.receiveAmount, solverId,
        destinationTxHash: destTxHash ?? undefined,
    }
}
