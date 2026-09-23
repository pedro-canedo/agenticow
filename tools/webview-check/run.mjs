#!/usr/bin/env node
// Verifica, com o webview real do sistema, que a UI do AgenticOw funciona
// dentro da janela do app: sobe o runtime com um registrador de requisições,
// abre o app Tauri de verificação e decide pelo que o Host recebeu.
//
//   node tools/webview-check/run.mjs --runtime <dir> --app <binário> --mode child|iframe
//
// `child` (o desenho do AgenticOw) reprova se faltar: troca do token (303),
// `/` com cookie (200), WebSocket com cookie ou uma página sem erros.
// `iframe` só relata — o resultado varia por webview e é informativo.

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { runtime: { type: 'string' }, app: { type: 'string' }, mode: { type: 'string', default: 'child' } } })
if (!values.runtime || !values.app) {
  process.stderr.write('uso: run.mjs --runtime <dir> --app <binário> --mode child|iframe\n')
  process.exit(2)
}
const runtime = resolve(values.runtime)
const reqlog = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'reqlog.mjs')).href
const home = mkdtempSync(join(tmpdir(), 'agenticow-webview-'))

const host = spawn(process.execPath, [join(runtime, 'bin', 'agenticow-host.mjs'), '--port', '0'], {
  cwd: runtime,
  env: { ...process.env, DSH_HOME: home, NODE_OPTIONS: `--import=${reqlog}` },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let stderr = ''
host.stderr.on('data', (d) => { stderr += d })
const saidaHost = new Promise((ok) => host.once('exit', (code) => ok(code)))

const ready = await new Promise((ok, falha) => {
  const t = setTimeout(() => falha(new Error(`sem ready em 90 s\n${stderr.slice(-3000)}`)), 90_000)
  createInterface({ input: host.stdout }).on('line', (linha) => {
    const msg = JSON.parse(linha)
    if (msg.type === 'ready') { clearTimeout(t); ok(msg) }
    if (msg.type === 'fatal') { clearTimeout(t); falha(new Error(`fatal: ${msg.message}`)) }
  })
  saidaHost.then((code) => { clearTimeout(t); falha(new Error(`Host saiu (${code}) antes do ready\n${stderr.slice(-3000)}`)) })
})

const app = spawn(resolve(values.app), [], {
  env: { ...process.env, OW_URL: ready.url, OW_MODE: values.mode },
  stdio: ['ignore', 'inherit', 'inherit'],
})
const codigoApp = await new Promise((ok) => app.once('exit', (code) => ok(code)))

host.stdin.write(JSON.stringify({ ow: 1, type: 'shutdown' }) + '\n')
const codigoHost = await saidaHost
rmSync(home, { recursive: true, force: true })

const reqs = stderr.split('\n').filter((l) => l.startsWith('REQ '))
const probe = reqs.find((l) => l.includes('/__ow_probe'))
const params = probe === undefined ? undefined : new URL(`http://x${probe.split(' ')[2]}`).searchParams
const resultado = {
  mode: values.mode,
  plataforma: `${process.platform}-${process.arch}`,
  app: codigoApp,
  host: codigoHost,
  troca303: reqs.some((l) => /GET \/\?token=\*\*\* \[[^\]]+\] -> 303/.test(l)),
  raizComCookie200: reqs.some((l) => /GET \/ \[cookie\] -> 200/.test(l)),
  raizSemCookie401: reqs.some((l) => /GET \/ \[sem-cookie\] -> 401/.test(l)),
  webSocketComCookie: reqs.some((l) => /WS-UPGRADE \/api\/remote\.mux \[cookie\]/.test(l)),
  sonda: params === undefined ? null : { erros: Number(params.get('n')), detalhe: params.get('erros'), texto: params.get('texto') },
  requisicoes: reqs.length,
}
process.stdout.write(JSON.stringify(resultado, undefined, 2) + '\n')

if (values.mode === 'child') {
  const ok = resultado.troca303 && resultado.raizComCookie200 && resultado.webSocketComCookie
    && resultado.sonda !== null && resultado.sonda.erros === 0 && (resultado.sonda.texto ?? '').trim() !== ''
    && codigoHost === 0
  if (!ok) {
    process.stderr.write(`REPROVADO: a UI não funcionou na child webview.\n${reqs.join('\n')}\n`)
    process.exit(1)
  }
  process.stdout.write('APROVADO: child webview com cookie, WebSocket e página sem erros.\n')
}
