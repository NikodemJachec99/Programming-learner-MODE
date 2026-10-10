#!/usr/bin/env node
// Aktualizacja lokalnej instalacji Mentora po zmianie kodu. Jedno polecenie:
//   node scripts/update-local.mjs
//
// 1. Wersja: źródłem prawdy jest .claude-plugin/plugin.json pluginu. Skrypt przepisuje ją
//    do hooks/version.ts i do marketplace.json, żeby nic się nie rozjechało.
// 2. Instalacja: `claude plugin marketplace update` i `claude plugin update` (user scope).
// 3. Cache: Claude Code trzyma kopię pluginu w ~/.claude/plugins/cache/<marketplace>/code-mentor/<wersja>.
//    Sesja, która już działa, czyta z katalogu wersji, z którą wystartowała, więc skrypt wgrywa
//    aktualny kod do KAŻDEGO katalogu wersji. Wtedy wystarczy /reload-plugins, bez nowej sesji.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = ['plugin', path.join('plugins', 'code-mentor')].map(p => path.join(root, p)).find(p => fs.existsSync(path.join(p, '.claude-plugin', 'plugin.json')))
if (!pluginDir) throw new Error(`Nie znalazłem pluginu w ${root}`)
const marketFile = path.join(root, '.claude-plugin', 'marketplace.json')
const market = JSON.parse(fs.readFileSync(marketFile, 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'))
const version = manifest.version
const id = `code-mentor@${market.name}`
const say = m => console.log(`  ${m}`)

// 1. wersja w jednym miejscu
const versionTs = path.join(pluginDir, 'hooks', 'version.ts')
const vt = fs.readFileSync(versionTs, 'utf8')
const vtNew = vt.replace(/MENTOR_VERSION = '[^']*'/, `MENTOR_VERSION = '${version}'`)
if (vtNew !== vt) fs.writeFileSync(versionTs, vtNew)
let marketChanged = false
for (const p of market.plugins) if (p.name === 'code-mentor' && p.version !== version) ((p.version = version), (marketChanged = true))
if (marketChanged) fs.writeFileSync(marketFile, JSON.stringify(market, null, 2) + '\n')
say(`wersja ${version} (plugin.json → version.ts, marketplace.json)`)

// 2. instalacja
const claude = args => {
  const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  try {
    return execFileSync('claude', args, opts)
  } catch (e) {
    // npm-owe claude.cmd na Windows uruchamia się tylko przez powłokę
    if (e.code !== 'ENOENT' || process.platform !== 'win32') throw e
    return execFileSync('cmd.exe', ['/d', '/s', '/c', ['claude', ...args].join(' ')], opts)
  }
}
try {
  claude(['plugin', 'marketplace', 'update', market.name])
  const out = claude(['plugin', 'update', id, '--scope', 'user'])
  say(out.trim().split('\n').pop() ?? 'zaktualizowane')
} catch (e) {
  say(`claude plugin update: ${String(e.stderr || e.message).trim().split('\n').pop()}`)
}

// 3. aktualny kod do każdej wersji w cache
const cacheRoot = path.join(os.homedir(), '.claude', 'plugins', 'cache', market.name, 'code-mentor')
const copied = []
if (fs.existsSync(cacheRoot)) {
  for (const v of fs.readdirSync(cacheRoot)) {
    const dest = path.join(cacheRoot, v)
    if (!fs.statSync(dest).isDirectory()) continue
    for (const part of ['hooks', 'helper', 'types', 'tests', '.claude-plugin']) {
      const src = path.join(pluginDir, part)
      if (!fs.existsSync(src)) continue
      fs.rmSync(path.join(dest, part), { recursive: true, force: true })
      fs.cpSync(src, path.join(dest, part), { recursive: true, filter: s => !s.includes(`${path.sep}node_modules`) && !s.includes(`.claude-plugin${path.sep}types`) })
    }
    for (const f of ['tsconfig.json']) if (fs.existsSync(path.join(pluginDir, f))) fs.copyFileSync(path.join(pluginDir, f), path.join(dest, f))
    copied.push(v)
  }
}
say(copied.length ? `kod wgrany do cache: ${copied.join(', ')}` : 'brak katalogów w cache (pierwsza instalacja: claude plugin install)')
console.log(`\nGotowe. W otwartej sesji wpisz /reload-plugins, nagłówek panelu pokaże „Claude Code Mentor ${version}”.`)
