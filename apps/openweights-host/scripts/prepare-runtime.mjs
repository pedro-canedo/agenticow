#!/usr/bin/env node
/**
 * Monta o runtime do AgenticOw que o OpenWeights instala: a árvore de produção
 * do host, autocontida, sem nenhum `npm install` na máquina da pessoa.
 *
 *   node apps/openweights-host/scripts/prepare-runtime.mjs --out <dir> [--target linux-x64]
 *
 * Etapas (cada uma falha alto, nunca "quase"):
 *   1. `pnpm deploy --prod` hoisted do @openweights/agenticow-host;
 *   2. materializa os overrides `link:vendor/*` do pnpm-workspace.yaml — no
 *      deploy um vira symlink para fora da árvore e o outro SOME;
 *   3. recusa qualquer symlink que aponte para fora da árvore;
 *   4. verifica que toda dependência e peer obrigatório resolve (os seams do
 *      upstream são peers que o próprio CLI não declara — ver FORK.md);
 *   5. tira o que não serve em runtime: sourcemaps, declarações de tipo e os
 *      prebuilds do node-pty de outras plataformas;
 *   6. escreve THIRD_PARTY_LICENSES.txt (closure inteira) e runtime.json.
 */

import { spawnSync } from 'node:child_process'
import {
  cpSync, existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const HOST = '@openweights/agenticow-host'
const RUNTIME_NAME = 'agenticow-runtime'
const FORMATO = 1

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    target: { type: 'string', default: `${process.platform}-${process.arch}` },
    revision: { type: 'string' },
    'upstream-tag': { type: 'string' },
  },
})
if (values.out === undefined) falhar('uso: prepare-runtime.mjs --out <dir> [--target <os-arch>]')
const OUT = resolve(values.out)
const [ALVO_OS, ALVO_ARCH] = values.target.split('-')

function falhar(msg) {
  process.stderr.write(`prepare-runtime: ${msg}\n`)
  process.exit(1)
}

function rodar(cmd, args, opcoes = {}) {
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8', shell: process.platform === 'win32', ...opcoes })
  if (r.status !== 0) falhar(`${cmd} ${args.join(' ')} saiu com ${r.status}\n${(r.stderr || r.stdout || '').slice(-3000)}`)
  return r.stdout.trim()
}

function* caminhar(dir) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    const st = lstatSync(p)
    yield { p, st }
    if (st.isDirectory() && !st.isSymbolicLink()) yield* caminhar(p)
  }
}

function dentro(p) {
  return p === OUT || p.startsWith(OUT + sep)
}

// ── 1. deploy ───────────────────────────────────────────────────────────────
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
rodar('pnpm', ['--filter', HOST, 'deploy', '--prod', '--legacy', '--config.node-linker=hoisted', OUT], {
  env: { ...process.env, CI: 'true' },
})
const NM = join(OUT, 'node_modules')

// ── 2. overrides link:vendor/* ──────────────────────────────────────────────
const workspace = readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8')
const vendorLinks = [...workspace.matchAll(/^\s+'?(@[\w-]+\/[\w-]+|[\w-]+)'?:\s*'?link:(vendor\/[\w-]+)'?\s*$/gm)]
  .map(([, nome, dir]) => ({ nome, dir: join(REPO, dir) }))
if (vendorLinks.length === 0) falhar('nenhum override link:vendor/* encontrado — o pnpm-workspace.yaml mudou?')
for (const { nome, dir } of vendorLinks) {
  const destino = join(NM, ...nome.split('/'))
  if (existsSync(destino) || isLink(destino)) rmSync(destino, { recursive: true, force: true })
  cpSync(dir, destino, { recursive: true, dereference: true, filter: (src) => !src.split(sep).includes('node_modules') })
}

function isLink(p) {
  try { return lstatSync(p).isSymbolicLink() } catch { return false }
}

// ── 3. symlinks para fora da árvore ─────────────────────────────────────────
for (const { p, st } of caminhar(OUT)) {
  if (!st.isSymbolicLink()) continue
  const alvo = resolve(dirname(p), readlinkSync(p))
  if (dentro(alvo)) continue
  const real = realpathSync(p)
  rmSync(p, { recursive: true, force: true })
  cpSync(real, p, { recursive: true, dereference: true })
}
for (const { p, st } of caminhar(OUT)) {
  if (st.isSymbolicLink() && !dentro(resolve(dirname(p), readlinkSync(p)))) falhar(`symlink para fora da árvore: ${relative(OUT, p)}`)
}

// ── 4. toda dependência e peer obrigatório resolve ─────────────────────────
function pacotes(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => !n.startsWith('.')).flatMap((n) => (n.startsWith('@')
    ? readdirSync(join(dir, n)).map((m) => join(dir, n, m))
    : [join(dir, n)]))
}
function acha(nome, desde) {
  for (let d = desde; ; d = dirname(d)) {
    if (existsSync(join(d, 'node_modules', ...nome.split('/'), 'package.json'))) return true
    if (dirname(d) === d) return false
  }
}
const faltando = []
const manifestos = []
;(function visitar(dir) {
  for (const p of pacotes(dir)) {
    const arq = join(p, 'package.json')
    if (!existsSync(arq)) continue
    const m = JSON.parse(readFileSync(arq, 'utf8'))
    manifestos.push({ dir: p, m })
    const opcionais = m.peerDependenciesMeta ?? {}
    for (const dep of [...Object.keys(m.dependencies ?? {}), ...Object.keys(m.peerDependencies ?? {})]) {
      if (opcionais[dep]?.optional) continue
      if (m.optionalDependencies?.[dep] !== undefined) continue
      if (!acha(dep, p)) faltando.push(`${dep} (pedido por ${m.name})`)
    }
    visitar(join(p, 'node_modules'))
  }
})(NM)
if (faltando.length > 0) falhar(`dependências sem resolução:\n  ${[...new Set(faltando)].join('\n  ')}`)

// ── 5. o que não serve em runtime ──────────────────────────────────────────
const NAO_SERVE = /\.(map|d\.ts|d\.mts|d\.cts)$/
let removidos = 0
for (const { p, st } of [...caminhar(OUT)]) {
  if (st.isFile() && NAO_SERVE.test(p)) { rmSync(p); removidos++ }
}
const prebuilds = join(NM, 'node-pty', 'prebuilds')
const plataformaPty = `${ALVO_OS === 'win' ? 'win32' : ALVO_OS}-${ALVO_ARCH}`
if (existsSync(prebuilds)) {
  if (!existsSync(join(prebuilds, plataformaPty))) falhar(`node-pty sem prebuild para ${plataformaPty}`)
  for (const d of readdirSync(prebuilds)) if (d !== plataformaPty) rmSync(join(prebuilds, d), { recursive: true, force: true })
}

// ── 6. licenças e identidade ────────────────────────────────────────────────
const textos = new Map()
const linhas = []
for (const { dir, m } of manifestos.sort((a, b) => `${a.m.name}`.localeCompare(`${b.m.name}`))) {
  const arquivo = readdirSync(dir).find((n) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(n))
  const licenca = typeof m.license === 'string' ? m.license : (m.license?.type ?? 'SEM LICENÇA DECLARADA')
  linhas.push(`${m.name}@${m.version} — ${licenca}`)
  if (arquivo !== undefined) {
    const texto = readFileSync(join(dir, arquivo), 'utf8').trim()
    textos.set(texto, [...(textos.get(texto) ?? []), `${m.name}@${m.version}`])
  }
}
const cabecalho = [
  'AgenticOw — avisos de licença do runtime',
  '',
  'O AgenticOw é baseado no DeepSeek Harness (MIT, Copyright (c) 2026 DeepSeek);',
  'o componente native/system é BSD-3-Clause. Cada pacote abaixo mantém a própria',
  'licença; os textos completos seguem, agrupados por texto idêntico.',
  '',
  `${linhas.length} pacotes:`,
  ...linhas.map((l) => `  ${l}`),
  '',
]
const corpo = [...textos].map(([texto, quem]) => `${'='.repeat(78)}\n${quem.join(', ')}\n${'-'.repeat(78)}\n${texto}\n`)
writeFileSync(join(OUT, 'THIRD_PARTY_LICENSES.txt'), cabecalho.join('\n') + '\n' + corpo.join('\n'))
const raizLicenca = readFileSync(join(REPO, 'LICENSE'), 'utf8')
writeFileSync(join(OUT, 'LICENSE'), raizLicenca)

const hostPkg = JSON.parse(readFileSync(join(OUT, 'package.json'), 'utf8'))
const revision = values.revision ?? process.env.GITHUB_SHA ?? rodar('git', ['rev-parse', 'HEAD'])
// A tag base do upstream é declarada no package.json do host (atualizada em cada
// sincronização): o repositório do fork não carrega as tags do upstream, e o
// checkout da CI é raso.
const upstreamTag = values['upstream-tag'] ?? hostPkg.agenticow?.upstreamTag
if (typeof upstreamTag !== 'string' || !/^dsh-v\d/.test(upstreamTag)) falhar('agenticow.upstreamTag ausente no package.json do host')
const dshPkg = JSON.parse(readFileSync(join(NM, '@deepseek-ai', 'dsh', 'package.json'), 'utf8'))

let arquivos = 0
let bytes = 0
let maiorCaminho = 0
for (const { p, st } of caminhar(OUT)) {
  if (!st.isFile()) continue
  arquivos++
  bytes += st.size
  maiorCaminho = Math.max(maiorCaminho, relative(OUT, p).length)
}
const identidade = {
  name: RUNTIME_NAME,
  format: FORMATO,
  revision,
  upstreamTag,
  host: hostPkg.version,
  dsh: dshPkg.version,
  target: values.target,
  entry: 'bin/agenticow-host.mjs',
  buildNode: process.version,
  buildNodeAbi: process.versions.modules,
  files: arquivos,
  bytes,
  longestPath: maiorCaminho,
}
writeFileSync(join(OUT, 'runtime.json'), JSON.stringify(identidade, undefined, 2) + '\n')
process.stdout.write(`${JSON.stringify({ ...identidade, removidos }, undefined, 2)}\n`)
