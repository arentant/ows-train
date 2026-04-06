#!/usr/bin/env npx tsx

import { parseArgs } from 'node:util'
import { bridge, refund, redeem, payAndAccess } from '../src/index.js'

const DEFAULT_API_URL = 'https://train-solver-station.lb.layerswap.io'

// ── ANSI ─────────────────────────────────────────────────────────────

const E = '\x1b'
const HIDE = `${E}[?25l`
const SHOW = `${E}[?25h`
const CL = `${E}[2K\r`
const UP = (n) => `${E}[${n}A`
const DN = (n) => `${E}[${n}B`
const D = `${E}[2m`
const R = `${E}[0m`
const B = `${E}[1m`
const GR = `${E}[32m`
const YL = `${E}[33m`
const CY = `${E}[36m`
const RD = `${E}[31m`

const fg = (c) => `${E}[38;5;${c}m`
const bg = (c) => `${E}[48;5;${c}m`

// ── Pixel bullet train ───────────────────────────────────────────────
// Half-block rendering: ▀ = top pixel (fg), bottom pixel (bg)
// Each terminal row = 2 pixel rows

const K = 0, b = 33, d = 26, w = 255, g = 250, _ = -1

const PIXELS = [
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, K, K, K, K, K, K, K, K, K, K, K, K, K, K, K, K, K, _, _, _, _], // Top border
    [_, K, b, b, b, b, b, b, b, b, b, b, b, K, w, w, w, w, K, _, _, _], // Window top
    [_, K, b, K, b, K, b, b, b, b, b, b, K, w, w, w, w, w, w, K, _, _], // Window mid
    [_, K, b, K, b, K, b, b, b, b, b, b, K, w, w, w, w, w, w, w, K, _], // Window bot
    [_, K, b, b, b, b, b, b, b, b, b, b, b, K, K, K, K, K, K, K, K, K], // Nose line
    [_, K, w, w, w, w, w, w, w, w, w, w, w, b, b, b, b, b, b, b, b, K], // Bottom stripe
    [_, K, K, K, K, K, K, K, K, K, K, K, K, K, K, K, K, K, K, K, K, K], // Bottom border
]

const TRAIN_PIXEL_W = PIXELS[0].length
const TRAIN_ROWS = PIXELS.length / 2  // 4 terminal rows

function halfBlock(top, bot) {
    if (top === _ && bot === _) return ' '
    if (top === _) return fg(bot) + '▄' + R
    if (bot === _) return fg(top) + '▀' + R
    return bg(bot) + fg(top) + '▀' + R
}

function renderTrainLine(row, offset) {
    const topRow = PIXELS[row * 2]
    const botRow = PIXELS[row * 2 + 1]
    let out = ' '.repeat(Math.max(0, offset))
    for (let c = 0; c < TRAIN_PIXEL_W; c++) {
        out += halfBlock(topRow[c], botRow[c])
    }
    return out
}

// ── Steps ────────────────────────────────────────────────────────────

const STEPS = [
    { key: 'resolving_networks', label: 'Resolve networks' },
    { key: 'fetching_quote', label: 'Fetch quote' },
    { key: 'locking_funds', label: 'Lock funds' },
    { key: 'waiting_solver', label: 'Solver lock' },
    { key: 'verifying_solver', label: 'Verify' },
    { key: 'revealing_secret', label: 'Reveal secret' },
    { key: 'waiting_completion', label: 'Complete' },
]

// ── UI ───────────────────────────────────────────────────────────────

const cols = Math.min(process.stdout.columns || 80, 100)

class TrainUI {
    #stepIdx = -1
    #results = new Map()
    #frame = 0
    #timer = null
    #t0 = 0
    #msg = ''
    #drawn = false
    #pos = 0
    #target = 0

    // train(4) + track(1) + status(1) + gap(1) + steps(7) + gap(1) = 15
    get #h() { return TRAIN_ROWS + 1 + 1 + 1 + STEPS.length + 1 }

    start() {
        process.stdout.write(HIDE)
        this.#t0 = Date.now()
        this.#draw()
    }

    setStep(key, msg) {
        const idx = STEPS.findIndex(s => s.key === key)
        if (idx < 0) return

        if (idx > this.#stepIdx && this.#stepIdx >= 0) {
            const prev = STEPS[this.#stepIdx].key
            if (!this.#results.has(prev)) this.#results.set(prev, { ok: true, d: '' })
        }

        this.#stepIdx = idx
        this.#msg = msg
        const maxPos = cols - TRAIN_PIXEL_W - 2
        this.#target = Math.floor(((idx + 0.5) / STEPS.length) * maxPos)

        if (!this.#timer) this.#timer = setInterval(() => this.#tick(), 80)
        this.#draw()
    }

    done(key, detail = '') { this.#results.set(key, { ok: true, d: detail }); this.#draw() }
    fail(key, detail = '') { this.#results.set(key, { ok: false, d: detail }); this.#draw() }

    finish(ok) {
        clearInterval(this.#timer); this.#timer = null
        this.#pos = cols - TRAIN_PIXEL_W - 2
        for (const s of STEPS) {
            if (!this.#results.has(s.key)) this.#results.set(s.key, { ok, d: '' })
        }
        this.#msg = ''
        this.#draw()
        process.stdout.write(SHOW)
    }

    #tick() {
        if (this.#pos < this.#target) this.#pos = Math.min(this.#pos + 1, this.#target)
        this.#frame++
        // redraw only train + track + status (top 6 lines)
        process.stdout.write(UP(this.#h))
        this.#writeTrainAndTrack()
        const sec = ((Date.now() - this.#t0) / 1000).toFixed(1)
        console.log(`${CL}  ${CY}${this.#msg}${R} ${D}${sec}s${R}`)
        process.stdout.write(DN(this.#h - TRAIN_ROWS - 2))
    }

    #draw() {
        if (this.#drawn) process.stdout.write(UP(this.#h))
        this.#drawn = true

        this.#writeTrainAndTrack()

        const sec = ((Date.now() - this.#t0) / 1000).toFixed(1)
        console.log(this.#msg ? `${CL}  ${CY}${this.#msg}${R} ${D}${sec}s${R}` : CL)

        console.log(CL)

        for (let i = 0; i < STEPS.length; i++) {
            const s = STEPS[i]
            const r = this.#results.get(s.key)
            if (r) {
                const icon = r.ok ? `${GR}✓${R}` : `${RD}✗${R}`
                const det = r.d ? ` ${D}${r.d}${R}` : ''
                console.log(`${CL}  ${icon} ${s.label}${det}`)
            } else if (i === this.#stepIdx) {
                console.log(`${CL}  ${CY}▸${R} ${B}${s.label}${R} ${D}...${R}`)
            } else {
                console.log(`${CL}  ${D}○ ${s.label}${R}`)
            }
        }
        console.log(CL)
    }

    #writeTrainAndTrack() {
        for (let r = 0; r < TRAIN_ROWS; r++) {
            console.log(`${CL}${renderTrainLine(r, this.#pos)}`)
        }
        // scrolling track
        const tw = cols - 2
        let track = ''
        for (let i = 0; i < tw; i++) {
            track += ((i + this.#frame) % 4 === 0) ? '╤' : '═'
        }
        console.log(`${CL}${D}${track}${R}`)
    }
}

// ── Subcommand detection ─────────────────────────────────────────────

const subcommand = process.argv[2]

if (subcommand === '-v' || subcommand === '--version') {
    console.log('ows-train 0.1.0')
    process.exit(0)
}

if (!subcommand || subcommand === '-h' || subcommand === '--help' || subcommand === 'help') {
    console.log(`
${B}ows-train${R} — Cross-chain bridge via Train Protocol

${B}USAGE${R}
  ows-train <command> [options]

${B}COMMANDS${R}
  bridge     Lock funds and bridge tokens across chains
  refund     Refund a locked HTLC after timelock expires
  redeem     Redeem a solver lock using the HTLC secret
  pay        Fetch a URL with automatic x402/MPP 402 payment

${B}OPTIONS${R}
  -h, --help       Show help
  -v, --version    Show version

Run ${D}ows-train <command> --help${R} for command-specific options.
`)
    process.exit(0)
}

if (subcommand === 'refund') {
    // ── Refund subcommand ───────────────────────────────────────────────
    const { values: refundValues } = parseArgs({
        args: process.argv.slice(3),
        options: {
            wallet: { type: 'string', short: 'w' },
            chain: { type: 'string', short: 'c' },
            hashlock: { type: 'string' },
            token: { type: 'string' },
            'rpc-url': { type: 'string' },
            'api-url': { type: 'string' },
            index: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
        strict: true,
    })

    if (refundValues.help || !refundValues.wallet || !refundValues.chain || !refundValues.hashlock || !refundValues.token) {
        console.log(`
${B}ows-train refund${R} — Refund a locked HTLC after timelock expires

${B}USAGE${R}
  ows-train refund -w <wallet> -c <chain> --hashlock <hash> --token <symbol>

${B}OPTIONS${R}
  -w, --wallet <name>       OWS wallet name ${D}(required)${R}
  -c, --chain <chain>       Chain where funds are locked ${D}(required)${R}
      --hashlock <hash>     HTLC hashlock ${D}(required)${R}
      --token <symbol>      Token symbol ${D}(required)${R}
      --rpc-url <url>       RPC URL override
      --api-url <url>       Train API URL ${D}(default: Train Station)${R}
      --index <n>           Solver lock index ${D}(omit for user refund)${R}
  -h, --help                Show help
`)
        process.exit(refundValues.help ? 0 : 1)
    }

    const refundApiUrl = refundValues['api-url'] || process.env.TRAIN_API_URL || DEFAULT_API_URL

    console.log()
    console.log(`  ${B}Train Protocol Refund${R}`)
    console.log(`  ${D}${refundValues.chain} · ${refundValues.hashlock.slice(0, 18)}…${R}`)
    console.log()

    try {
        const result = await refund({
            wallet: refundValues.wallet,
            chain: refundValues.chain,
            hashlock: refundValues.hashlock,
            token: refundValues.token,
            trainApiUrl: refundApiUrl,
            rpcUrl: refundValues['rpc-url'],
            passphrase: process.env.OWS_PASSPHRASE,
            index: refundValues.index != null ? parseInt(refundValues.index, 10) : undefined,
        })

        console.log(`  ${GR}${B}✓ Refund successful${R}`)
        console.log()
        console.log(`  ${D}Chain${R}        ${result.chain}`)
        console.log(`  ${D}Hashlock${R}     ${result.hashlock}`)
        console.log(`  ${D}TX${R}           ${result.txHash}`)
        console.log()
        process.exit(0)
    } catch (err) {
        console.log(`  ${RD}${B}✗ ${err.message}${R}`)
        console.log()
        process.exit(1)
    }
}

if (subcommand === 'redeem') {
    // ── Redeem subcommand ───────────────────────────────────────────────
    const { values: redeemValues } = parseArgs({
        args: process.argv.slice(3),
        options: {
            wallet: { type: 'string', short: 'w' },
            chain: { type: 'string', short: 'c' },
            hashlock: { type: 'string' },
            secret: { type: 'string' },
            token: { type: 'string' },
            'rpc-url': { type: 'string' },
            'api-url': { type: 'string' },
            index: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
        strict: true,
    })

    if (redeemValues.help || !redeemValues.wallet || !redeemValues.chain || !redeemValues.hashlock || !redeemValues.secret || !redeemValues.token) {
        console.log(`
${B}ows-train redeem${R} — Redeem a solver lock using the HTLC secret

${B}USAGE${R}
  ows-train redeem -w <wallet> -c <chain> --hashlock <hash> --secret <hex> --token <symbol>

${B}OPTIONS${R}
  -w, --wallet <name>       OWS wallet name ${D}(required)${R}
  -c, --chain <chain>       Chain where solver locked funds ${D}(required)${R}
      --hashlock <hash>     HTLC hashlock ${D}(required)${R}
      --secret <hex>        HTLC secret / preimage ${D}(required)${R}
      --token <symbol>      Token symbol ${D}(required)${R}
      --rpc-url <url>       RPC URL override
      --api-url <url>       Train API URL ${D}(default: Train Station)${R}
      --index <n>           Solver lock index ${D}(default: 0)${R}
  -h, --help                Show help
`)
        process.exit(redeemValues.help ? 0 : 1)
    }

    const redeemApiUrl = redeemValues['api-url'] || process.env.TRAIN_API_URL || DEFAULT_API_URL

    console.log()
    console.log(`  ${B}Train Protocol Redeem${R}`)
    console.log(`  ${D}${redeemValues.chain} · ${redeemValues.hashlock.slice(0, 18)}…${R}`)
    console.log()

    try {
        const result = await redeem({
            wallet: redeemValues.wallet,
            chain: redeemValues.chain,
            hashlock: redeemValues.hashlock,
            secret: redeemValues.secret,
            token: redeemValues.token,
            trainApiUrl: redeemApiUrl,
            rpcUrl: redeemValues['rpc-url'],
            passphrase: process.env.OWS_PASSPHRASE,
            index: redeemValues.index != null ? parseInt(redeemValues.index, 10) : undefined,
        })

        console.log(`  ${GR}${B}✓ Redeem successful${R}`)
        console.log()
        console.log(`  ${D}Chain${R}        ${result.chain}`)
        console.log(`  ${D}Hashlock${R}     ${result.hashlock}`)
        console.log(`  ${D}TX${R}           ${result.txHash}`)
        console.log()
        process.exit(0)
    } catch (err) {
        console.log(`  ${RD}${B}✗ ${err.message}${R}`)
        console.log()
        process.exit(1)
    }
}

if (subcommand === 'pay') {
    // ── Pay subcommand: bridge funds then call ows pay ───────────────
    const { values: payValues } = parseArgs({
        args: process.argv.slice(3),
        allowPositionals: true,
        options: {
            wallet: { type: 'string', short: 'w' },
            'source-chain': { type: 'string', short: 'f' },
            'source-token': { type: 'string' },
            'source-rpc': { type: 'string' },
            'dest-rpc': { type: 'string' },
            'api-url': { type: 'string' },
            method: { type: 'string', short: 'm', default: 'GET' },
            header: { type: 'string', short: 'H', multiple: true },
            data: { type: 'string', short: 'd' },
            help: { type: 'boolean', short: 'h' },
        },
        strict: true,
    })

    const payUrl = process.argv[3]

    if (payValues.help || !payUrl || !payValues.wallet || !payValues['source-chain']) {
        console.log(`
${B}ows-train pay${R} — Bridge funds then pay via ows pay (x402/MPP)

${B}USAGE${R}
  ows-train pay <url> -w <wallet> --source-chain <chain>

${B}OPTIONS${R}
  -w, --wallet <name>           OWS wallet name ${D}(required)${R}
  -f, --source-chain <chain>    Source chain for bridging ${D}(required)${R}
      --source-token <symbol>   Token to pay with on source chain ${D}(defaults to dest token)${R}
      --source-rpc <url>        Source chain RPC override
      --dest-rpc <url>          Destination chain RPC override
      --api-url <url>           Train API URL ${D}(default: Train Station)${R}
  -m, --method <method>         HTTP method ${D}(default: GET)${R}
  -H, --header <key:value>      HTTP header (repeatable)
  -d, --data <body>             Request body
  -h, --help                    Show help

${B}FLOW${R}
  1. Fetch URL → detect HTTP 402 payment requirements
  2. Bridge funds from source chain to payment chain via Train Protocol
  3. Call ${D}ows pay request${R} to complete the payment
`)
        process.exit(payValues.help ? 0 : 1)
    }

    const payApiUrl = payValues['api-url'] || process.env.TRAIN_API_URL || DEFAULT_API_URL

    // Build request headers
    const reqHeaders = {}
    if (payValues.header) {
        for (const h of payValues.header) {
            const sep = h.indexOf(':')
            if (sep > 0) reqHeaders[h.slice(0, sep).trim()] = h.slice(sep + 1).trim()
        }
    }

    console.log()
    console.log(`  ${B}Train Protocol Pay${R}`)
    console.log(`  ${D}${payValues.method ?? 'GET'} ${payUrl}${R}`)
    console.log()

    try {
        const result = await payAndAccess(
            payUrl,
            {
                wallet: payValues.wallet,
                sourceChain: payValues['source-chain'],
                sourceToken: payValues['source-token'],
                sourceRpcUrl: payValues['source-rpc'],
                destinationRpcUrl: payValues['dest-rpc'],
                trainApiUrl: payApiUrl,
                passphrase: process.env.OWS_PASSPHRASE,
                method: payValues.method ?? 'GET',
                headers: reqHeaders,
                body: payValues.data,
                onProgress: (msg) => console.log(`  ${CY}${msg}${R}`),
            },
        )

        console.log()
        console.log(`  ${D}Protocol${R}     ${result.protocol.toUpperCase()}`)
        if (result.bridgeResult) {
            console.log(`  ${D}Bridge TX${R}    ${result.bridgeResult.sourceTxHash}`)
            if (result.bridgeResult.destinationTxHash) {
                console.log(`  ${D}Dest TX${R}      ${result.bridgeResult.destinationTxHash}`)
            }
        }

        if (result.success) {
            console.log(`  ${GR}${B}✨ Payment successful!${R}`)
            if (result.output) {
                console.log()
                console.log(result.output)
            }
        } else {
            console.log(`  ${RD}${B}✗ Payment failed${R}`)
            if (result.output) {
                console.log(`  ${D}${result.output}${R}`)
            }
        }
        console.log()

        process.exit(result.success ? 0 : 1)
    } catch (err) {
        console.log(`  ${RD}${B}✗ ${err.message}${R}`)
        console.log()
        process.exit(1)
    }
}

// ── Parse args (bridge subcommand) ───────────────────────────────────

// Reject unknown subcommands that look like a command name (no dash prefix)
if (subcommand && subcommand !== 'bridge' && !subcommand.startsWith('-')) {
    console.error(`${RD}Unknown command: ${subcommand}${R}`)
    console.error(`Run ${D}ows-train --help${R} for available commands.`)
    process.exit(1)
}

// Strip optional "bridge" subcommand
const bridgeArgs = subcommand === 'bridge' ? process.argv.slice(3) : process.argv.slice(2)

const { values } = parseArgs({
    args: bridgeArgs,
    allowPositionals: true,
    options: {
        wallet: { type: 'string', short: 'w' },
        from: { type: 'string', short: 'f' },
        to: { type: 'string', short: 't' },
        token: { type: 'string' },
        amount: { type: 'string', short: 'a' },
        'receive-amount': { type: 'string', short: 'r' },
        'dest-address': { type: 'string' },
        'api-url': { type: 'string' },
        'source-rpc': { type: 'string' },
        'dest-rpc': { type: 'string' },
        'dest-token': { type: 'string' },
        timeout: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
    },
    strict: true,
})

if (values.help || !values.wallet || !values.from || !values.to || !values.token || (!values.amount && !values['receive-amount'])) {
    console.log(`
${B}ows-train bridge${R} — Cross-chain bridge via Train Protocol

${B}USAGE${R}
  ows-train bridge -w <wallet> -f <chain> -t <chain> --token <symbol> -a <amount>
  ows-train bridge -w <wallet> -f <chain> -t <chain> --token <symbol> -r <amount>

${B}OPTIONS${R}
  -w, --wallet <name>           OWS wallet name ${D}(required)${R}
  -f, --from <chain>            Source chain ${D}(required)${R}
  -t, --to <chain>              Destination chain ${D}(required)${R}
      --token <symbol>          Token symbol ${D}(required)${R}
  -a, --amount <value>          Amount to lock on source ${D}(or use -r)${R}
  -r, --receive-amount <value>  Amount to receive on destination ${D}(or use -a)${R}
      --dest-address <addr>     Custom destination address
      --api-url <url>           Train API URL ${D}(default: Train Station)${R}
      --source-rpc <url>        Source chain RPC override
      --dest-rpc <url>          Destination chain RPC override
      --dest-token <symbol>     Destination token ${D}(defaults to --token)${R}
      --timeout <ms>            Solver timeout ${D}(default: 120000)${R}
  -h, --help                    Show help
`)
    process.exit(values.help ? 0 : 1)
}

if (values.amount && values['receive-amount']) {
    console.log(`${RD}Error: Provide either --amount or --receive-amount, not both${R}`)
    process.exit(1)
}

const apiUrl = values['api-url'] || process.env.TRAIN_API_URL || DEFAULT_API_URL

// ── Progress ─────────────────────────────────────────────────────────

const ui = new TrainUI()
let lastStep = null

function handleProgress({ step, message, data }) {
    if (step === 'done') return
    if (step !== lastStep) { ui.setStep(step, message); lastStep = step }
    if (data) {
        let detail = ''
        if (step === 'fetching_quote' && data.receiveAmount)
            detail = values['receive-amount']
                ? `lock ${data.amount} ${data.sourceToken} → receive ${data.receiveAmount} ${data.destToken} (fee: ${data.fee} ${data.sourceToken})`
                : `receive ${data.receiveAmount} ${data.destToken} (fee: ${data.fee} ${data.sourceToken})`
        else if (step === 'locking_funds' && data.txHash)
            detail = trunc(data.txHash)
        else if (step === 'resolving_networks' && data.sourceNetwork)
            detail = `${data.sourceNetwork} → ${data.destNetwork}`
        ui.done(step, detail)
    }
}

function trunc(h) {
    if (!h || h.length < 16) return h
    return `${h.slice(0, 10)}…${h.slice(-8)}`
}

// ── Run ───────────────────────────────────────────────────────────────

process.on('exit', () => process.stdout.write(SHOW))
process.on('SIGINT', () => { process.stdout.write(SHOW); process.exit(130) })

console.log()
console.log(`  ${B}Train Protocol Bridge${R}`)
const destTokenLabel = values['dest-token'] || values.token
const amountLabel = values.amount
    ? `${values.amount} ${values.token} → ${destTokenLabel}`
    : `→ ${values['receive-amount']} ${destTokenLabel}`
console.log(`  ${D}${amountLabel} · ${values.from} → ${values.to}${R}`)
console.log()

ui.start()

try {
    const result = await bridge({
        wallet: values.wallet,
        sourceChain: values.from,
        destinationChain: values.to,
        token: values.token,
        amount: values.amount,
        receiveAmount: values['receive-amount'],
        destinationAddress: values['dest-address'],
        trainApiUrl: apiUrl,
        sourceRpcUrl: values['source-rpc'],
        destinationRpcUrl: values['dest-rpc'],
        destinationToken: values['dest-token'],
        solverTimeout: values.timeout ? parseInt(values.timeout, 10) : undefined,
        passphrase: process.env.OWS_PASSPHRASE,
        onProgress: handleProgress,
    })

    ui.finish(result.status === 'completed')

    console.log()
    if (result.status === 'completed') {
        console.log(`  ${GR}${B}✨ Bridge completed!${R}`)
    } else if (result.status === 'secret_revealed') {
        console.log(`  ${YL}${B}Secret revealed — awaiting finalization${R}`)
    } else if (result.status === 'pending_solver') {
        console.log(`  ${YL}${B}Solver timeout${R}`)
    } else {
        console.log(`  ${RD}${B}✗ Bridge failed${R}`)
    }

    console.log()
    console.log(`  ${D}Hashlock${R}     ${result.hashlock}`)
    console.log(`  ${D}Source TX${R}    ${result.sourceTxHash}`)
    if (result.destinationTxHash) {
        console.log(`  ${D}Dest TX${R}      ${result.destinationTxHash}`)
    }
    console.log(`  ${D}Solver${R}       ${result.solverId}`)
    const destTokenSymbol = values['dest-token'] || values.token
    console.log(`  ${D}Receive${R}      ${result.receiveAmount} ${destTokenSymbol}`)
    if (result.error) {
        console.log(`  ${D}Note${R}         ${YL}${result.error}${R}`)
    }
    console.log()

    process.exit(result.status === 'error' ? 1 : 0)
} catch (err) {
    ui.finish(false)
    console.log()
    console.log(`  ${RD}${B}✗ ${err.message}${R}`)
    console.log()
    process.exit(1)
}
