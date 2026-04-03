#!/usr/bin/env node

/**
 * Postinstall script: copies the Train skill into all detected agent config directories.
 * Same pattern as OWS's install.sh skill installer.
 */

import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = join(__dirname, '..', 'skills', 'train')
const SKILL_FILE = join(SKILL_DIR, 'SKILL.md')

if (!existsSync(SKILL_FILE)) {
    // Running from source without skill file — skip silently
    process.exit(0)
}

const HOME = homedir()
const SKILL_NAME = 'train'

// Agent config directories (same list as OWS install.sh)
const AGENTS = [
    ['.agents', 'Universal'],
    ['.claude', 'Claude Code'],
    ['.config/agents', 'Amp'],
    ['.cursor', 'Cursor'],
    ['.copilot', 'GitHub Copilot'],
    ['.codex', 'Codex'],
    ['.gemini', 'Gemini CLI'],
    ['.config/opencode', 'OpenCode'],
    ['.config/goose', 'Goose'],
    ['.windsurf', 'Windsurf'],
    ['.codeium/windsurf', 'Windsurf'],
    ['.continue', 'Continue'],
    ['.roo', 'Roo'],
    ['.kiro', 'Kiro'],
    ['.augment', 'Augment'],
    ['.trae', 'Trae'],
]

const installed = []

for (const [relDir, agentName] of AGENTS) {
    const parentDir = join(HOME, relDir)
    if (!existsSync(parentDir)) continue

    const destDir = join(parentDir, 'skills', SKILL_NAME)
    try {
        mkdirSync(destDir, { recursive: true })
        copyFileSync(SKILL_FILE, join(destDir, 'SKILL.md'))
        installed.push(agentName)
    } catch {
        // Permission denied or other issue — skip silently
    }
}

if (installed.length > 0) {
    console.log(`  Installed train skill to ${installed.length} agent(s): ${installed.join(', ')}`)
}
