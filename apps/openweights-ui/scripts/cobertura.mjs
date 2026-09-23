#!/usr/bin/env node
/**
 * Cobertura do pt-BR contra os dicionários em inglês que a UI do upstream
 * registra de fato (extraídos dos bundles compilados). Falha se:
 *   - uma tradução tiver marcadores `{x}` diferentes do original (quebraria a UI);
 *   - existir namespace ou chave que o upstream não registra mais (tradução órfã);
 *   - a cobertura cair abaixo do mínimo (--min, padrão 100).
 *
 *   node scripts/cobertura.mjs [--en en.json] [--min 100]
 * Sem --en, roda o extrator (exige o build da workspace).
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: { en: { type: 'string' }, min: { type: 'string', default: '100' } } })
const en = values.en !== undefined
  ? JSON.parse(readFileSync(values.en, 'utf8'))
  : JSON.parse(execFileSync(process.execPath, [join(RAIZ, 'scripts', 'extrair-dicionarios.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }))

const PT = join(RAIZ, 'src', 'pt-BR')
const pt = Object.fromEntries(readdirSync(PT).filter((n) => n.endsWith('.json'))
  .map((n) => [n.slice(0, -5), JSON.parse(readFileSync(join(PT, n), 'utf8'))]))

const marcadores = (s) => [...String(s).matchAll(/\{[\w.]+\}/g)].map((m) => m[0]).sort().join(' ')
const erros = []
let total = 0
let traduzidas = 0
const faltando = {}
for (const [ns, dict] of Object.entries(en)) {
  for (const [chave, original] of Object.entries(dict)) {
    total++
    const traducao = pt[ns]?.[chave]
    if (traducao === undefined) {
      (faltando[ns] ??= []).push(chave)
      continue
    }
    traduzidas++
    if (marcadores(original) !== marcadores(traducao)) {
      erros.push(`${ns}.${chave}: marcadores ${marcadores(original) || '(nenhum)'} ≠ ${marcadores(traducao) || '(nenhum)'}`)
    }
  }
}
for (const [ns, dict] of Object.entries(pt)) {
  if (en[ns] === undefined) { erros.push(`namespace órfão: ${ns} (o upstream não registra mais)`); continue }
  for (const chave of Object.keys(dict)) if (en[ns][chave] === undefined) erros.push(`chave órfã: ${ns}.${chave}`)
}
const pct = total === 0 ? 100 : (100 * traduzidas) / total
process.stdout.write(`pt-BR: ${traduzidas}/${total} strings (${pct.toFixed(1)}%)\n`)
for (const [ns, chaves] of Object.entries(faltando)) process.stdout.write(`  faltando em ${ns}: ${chaves.length}\n`)
if (erros.length > 0) {
  process.stderr.write(`erros:\n  ${erros.join('\n  ')}\n`)
  process.exit(1)
}
if (pct < Number(values.min)) {
  process.stderr.write(`cobertura ${pct.toFixed(1)}% abaixo do mínimo ${values.min}%\n`)
  process.exit(1)
}
