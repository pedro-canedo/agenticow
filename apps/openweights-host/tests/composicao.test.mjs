// Contrato da composição do AgenticOw sobre o upstream, contra um runtime EMPACOTADO
// (AGENTICOW_RUNTIME). Se uma sincronização renomear uma linha que desligamos,
// o `disabled: true` do nosso patch vira um no-op silencioso — a telemetria
// voltaria a ligar sem ninguém perceber. Este teste lê a composição final.
//
//   AGENTICOW_RUNTIME=<dir> node --test tests/*.test.mjs

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { after, describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

const RUNTIME = process.env.AGENTICOW_RUNTIME
const pular = RUNTIME === undefined ? 'defina AGENTICOW_RUNTIME com um runtime empacotado' : false
const homes = []
after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }) })
const novoHome = () => { const h = mkdtempSync(join(tmpdir(), 'agenticow-composicao-')); homes.push(h); return h }

/** Linhas do dump: { id, name, disabled, texto }. */
function linhas(dump) {
  const out = []
  let atual
  for (const linha of dump.split('\n')) {
    const m = /^- id: (.+)$/.exec(linha)
    if (m) { atual = { id: m[1].trim(), name: undefined, disabled: false, texto: '' }; out.push(atual); continue }
    if (/^# ==/.test(linha)) { atual = undefined; continue }
    if (atual === undefined) continue
    atual.texto += linha + '\n'
    const n = /^ {2}name: '?([^']+)'?$/.exec(linha)
    if (n) atual.name = n[1]
    if (/^ {2}disabled: true$/.test(linha)) atual.disabled = true
  }
  return out
}

async function composicao() {
  const home = novoHome()
  const perfil = await import(pathToFileURL(join(RUNTIME, 'src', 'perfil.mjs')).href)
  perfil.garantirPerfil(home)
  const r = spawnSync(process.execPath, [join(RUNTIME, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    '--profile', 'openweights', '--dump-config'], { cwd: RUNTIME, env: { ...process.env, DSH_HOME: home }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  // A composição tem várias camadas; a última ocorrência de cada id é a que vale.
  const porId = new Map()
  for (const l of linhas(r.stdout)) porId.set(l.id, l)
  return porId
}

describe('composição do AgenticOw', { skip: pular }, () => {
  it('desliga o que manda dados para a DeepSeek', async () => {
    const c = await composicao()
    for (const id of ['session-telemetry-otel', 'command-feedback', 'message-feedback', 'ui-message-feedback', 'plugin-package-inventory-deepseek']) {
      assert.ok(c.has(id), `a linha "${id}" sumiu do upstream — o patch não a desliga mais; reveja o bundle`)
      assert.equal(c.get(id).disabled, true, `"${id}" tem de estar desligada`)
    }
  })

  it('insere os plugins do OpenWeights e esconde a URL com o token', async () => {
    const c = await composicao()
    assert.equal(c.get('openweights-control')?.name, '@openweights/agenticow-plugins/control')
    assert.equal(c.get('openweights-preferencias')?.name, '@openweights/agenticow-plugins/preferencias')
    assert.equal(c.get('openweights-ui')?.name, '@openweights/agenticow-ui')
    assert.equal(c.get('openweights-compat')?.name, '@openweights/agenticow-plugins/compat')
    assert.equal(c.get('openweights-catalog')?.name, '@openweights/agenticow-plugins/catalog')
    const web = c.get('web-runtime')?.texto ?? ''
    assert.match(web, /printUrl: false/)
    assert.match(web, /openBrowser: false/)
    assert.match(web, /surfaceContext: false/)
    assert.match(c.get('system-prompt')?.texto ?? '', /AgenticOw/)
  })

  it('lê a versão do aviso de boas-vindas do bundle do upstream', async () => {
    const m = await import(pathToFileURL(join(RUNTIME, 'node_modules', '@openweights', 'agenticow-plugins', 'src', 'preferencias.js')).href)
    assert.match(m.versaoDoAvisoDeBoasVindas() ?? '', /^\d{4}-\d{2}-\d{2}/, 'o formato mudou no upstream: em inglês o aviso da DeepSeek voltaria a aparecer')
  })

  it('não abre conexão de saída no boot e em repouso', async () => {
    const home = novoHome()
    const hook = pathToFileURL(join(import.meta.dirname, 'fixtures', 'egress.mjs')).href
    const filho = spawn(process.execPath, [join(RUNTIME, 'bin', 'agenticow-host.mjs'), '--port', '0'], {
      cwd: RUNTIME, env: { ...process.env, DSH_HOME: home, NODE_OPTIONS: `--import=${hook}` }, stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    filho.stderr.on('data', (d) => { stderr += d })
    await new Promise((ok, falha) => {
      const t = setTimeout(() => falha(new Error(`sem ready\n${stderr.slice(-2000)}`)), 60_000)
      createInterface({ input: filho.stdout }).on('line', (l) => { if (JSON.parse(l).type === 'ready') { clearTimeout(t); ok() } })
    })
    await new Promise((r) => setTimeout(r, 15_000))
    filho.stdin.write(JSON.stringify({ ow: 1, type: 'shutdown' }) + '\n')
    await new Promise((r) => filho.once('exit', r))
    const saidas = stderr.split('\n').filter((l) => l.startsWith('EGRESS ') && !/127\.0\.0\.1|::1|localhost/.test(l))
    assert.deepEqual(saidas, [], 'o runtime não pode falar com a rede sem uma sessão pedir')
  })
})
