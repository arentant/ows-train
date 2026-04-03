import type { TrainApiClient } from '@train-protocol/sdk'

/** Static mapping from common chain names to Train CAIP-2 namespace prefixes */
const CHAIN_NAME_TO_NAMESPACE: Record<string, string> = {
    // EVM chains
    ethereum: 'eip155:1',
    eth: 'eip155:1',
    sepolia: 'eip155:11155111',
    base: 'eip155:8453',
    'base-sepolia': 'eip155:84532',
    arbitrum: 'eip155:42161',
    'arbitrum-sepolia': 'eip155:421614',
    optimism: 'eip155:10',
    polygon: 'eip155:137',
    bsc: 'eip155:56',
    avalanche: 'eip155:43114',
    linea: 'eip155:59144',
    scroll: 'eip155:534352',
    zksync: 'eip155:324',
    // Non-EVM
    solana: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    'solana-devnet': 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    starknet: 'starknet:SN_MAIN',
    'starknet-sepolia': 'starknet:SN_SEPOLIA',
    ton: 'ton:mainnet',
    tron: 'tron:mainnet',
}

/** Fallback public RPC URLs by CAIP-2 ID */
const FALLBACK_RPC: Record<string, string> = {
    // EVM mainnets
    'eip155:1': 'https://ethereum-rpc.publicnode.com',
    'eip155:8453': 'https://base-rpc.publicnode.com',
    'eip155:42161': 'https://arbitrum-one-rpc.publicnode.com',
    'eip155:10': 'https://optimism-rpc.publicnode.com',
    'eip155:137': 'https://polygon-bor-rpc.publicnode.com',
    'eip155:56': 'https://bsc-rpc.publicnode.com',
    'eip155:43114': 'https://avalanche-c-chain-rpc.publicnode.com',
    'eip155:59144': 'https://linea-rpc.publicnode.com',
    'eip155:534352': 'https://scroll-rpc.publicnode.com',
    'eip155:324': 'https://zksync-era-rpc.publicnode.com',
    // EVM testnets
    'eip155:11155111': 'https://ethereum-sepolia-rpc.publicnode.com',
    'eip155:84532': 'https://base-sepolia-rpc.publicnode.com',
    'eip155:421614': 'https://arbitrum-sepolia-rpc.publicnode.com',
    // Solana
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'https://api.mainnet-beta.solana.com',
    'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': 'https://api.devnet.solana.com',
    // Starknet
    'starknet:SN_MAIN': 'https://starknet-mainnet-rpc.publicnode.com',
    'starknet:SN_SEPOLIA': 'https://starknet-sepolia-rpc.publicnode.com',
    // TON
    'ton:mainnet': 'https://toncenter.com/api/v2/jsonRPC',
}

/** Reverse: CAIP-2 → OWS chain family name (for wallet account lookup) */
const CAIP2_TO_OWS_CHAIN: Record<string, string> = {
    eip155: 'evm',
    solana: 'solana',
    starknet: 'starknet',
    ton: 'ton',
    tron: 'tron',
}

export interface ResolvedNetwork {
    caip2Id: string
    displayName: string
    namespace: string
    owsChain: string
    trainContract?: string
    rpcUrl?: string
    tokens: Array<{
        symbol: string
        contract: string
        decimals: number
    }>
}

/**
 * Resolve a user-friendly chain name to a Train network with full metadata.
 * Falls back to static CAIP-2 mapping if the API doesn't have the network.
 */
export async function resolveNetwork(
    chainName: string,
    apiClient: TrainApiClient,
): Promise<ResolvedNetwork> {
    const networks = await apiClient.getNetworks()

    // Try matching by chain name against CAIP-2 mapping, or use directly if already a CAIP-2 ID
    const caip2Id = CHAIN_NAME_TO_NAMESPACE[chainName.toLowerCase()] ??
        (chainName.includes(':') ? chainName : undefined)

    // Search Train networks by CAIP-2 ID or display name
    const network = networks.find(n =>
        n.caip2Id === caip2Id ||
        n.caip2Id === chainName ||
        n.displayName.toLowerCase() === chainName.toLowerCase()
    )

    if (!network && !caip2Id) {
        throw new Error(
            `Unknown chain "${chainName}". Supported: ${Object.keys(CHAIN_NAME_TO_NAMESPACE).join(', ')}`
        )
    }

    const effectiveCaip2 = network?.caip2Id ?? caip2Id!
    const namespace = effectiveCaip2.split(':')[0]

    return {
        caip2Id: effectiveCaip2,
        displayName: network?.displayName ?? chainName,
        namespace,
        owsChain: CAIP2_TO_OWS_CHAIN[namespace] ?? namespace,
        trainContract: network?.trainContract,
        rpcUrl: FALLBACK_RPC[effectiveCaip2],
        tokens: network?.tokens?.map(t => ({
            symbol: t.symbol,
            contract: t.contract,
            decimals: t.decimals,
        })) ?? [],
    }
}

/**
 * Find a token within a resolved network by symbol.
 */
export function findToken(network: ResolvedNetwork, symbol: string) {
    const lower = symbol.toLowerCase()
    const token = network.tokens.find(
        t => t.symbol.toLowerCase() === lower || t.contract.toLowerCase() === lower
    )
    if (!token) {
        // If it looks like a contract address, return a fallback with assumed 18 decimals
        if (symbol.startsWith('0x') && symbol.length > 10) {
            return { symbol, contract: symbol, decimals: 18 }
        }
        const available = network.tokens.map(t => t.symbol).join(', ')
        throw new Error(
            `Token "${symbol}" not found on ${network.displayName}. Available: ${available}`
        )
    }
    return token
}
