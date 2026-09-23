// O catálogo de modelos do app aplicado de ponta a ponta, contra um runtime
// EMPACOTADO (AGENTICOW_RUNTIME): chega pelo canal, vira a seção llm-pi-ai do
// settings.yaml pela API de configurações, repara o padrão, e a chave de API
// fica só na memória do processo.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { after, describe, it } from 'node:test'

const RUNTIME = process.env.AGENTICOW_RUNTIME
const pular = RUNTIME === undefined ? 'defina AGENTICOW_RUNTIME com um runtime empacotado' : false
const homes = []
after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }) })

const CHAVE = 'sk-teste-nunca-no-arquivo-7f3a'
const catalogo = (revision) => ({
  ow: 1,
  type: 'catalog',
  revision,
  env: { OPENWEIGHTS_API_KEY: CHAVE },
  piAi: {
    providers: {
      openweights: {
        displayName: 'OpenWeights (local)',
        api: 'openai-completions',
        baseURL: 'http://127.0.0.1:9/v1',
        apiKeyEnv: 'OPENWEIGHTS_API_KEY',
        models: [{ id: 'qwen3-8b', name: 'qwen3-8b', contextWindow: 32768, maxTokens: 16384 }],
      },
    },
  },
})

describe('catálogo do OpenWeights', { skip: pular }, () => {
  it('vira a seção llm-pi-ai, repara o padrão e não grava a chave', async () => {
    const home = mkdtempSync(join(tmpdir(), 'agenticow-catalogo-'))
    homes.push(home)
    const filho = spawn(process.execPath, [join(RUNTIME, 'bin', 'agenticow-host.mjs'), '--port', '0'], {
      cwd: RUNTIME, env: { ...process.env, DSH_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    filho.stderr.on('data', (d) => { stderr += d })
    const mensagens = []
    const chegou = (tipo) => new Promise((ok, falha) => {
      const t = setTimeout(() => falha(new Error(`sem "${tipo}"\n${stderr.slice(-2000)}`)), 60_000)
      const ver = () => { const m = mensagens.find((x) => x.type === tipo); if (m) { clearTimeout(t); ok(m) } else setTimeout(ver, 50) }
      ver()
    })
    createInterface({ input: filho.stdout }).on('line', (l) => mensagens.push(JSON.parse(l)))

    // Mandado antes de a árvore assentar: tem de ficar guardado e ser aplicado depois.
    filho.stdin.write(JSON.stringify(catalogo(7)) + '\n')
    const aplicado = await chegou('catalog-applied')
    assert.equal(aplicado.revision, 7)
    await chegou('ready')

    filho.stdin.write(JSON.stringify({ ow: 1, type: 'shutdown' }) + '\n')
    await new Promise((ok) => filho.once('exit', ok))

    const texto = readFileSync(join(home, 'settings.yaml'), 'utf8')
    assert.ok(!texto.includes(CHAVE), 'a chave de API não pode ir para arquivo')
    const yaml = createRequire(join(RUNTIME, 'package.json'))('js-yaml')
    const doc = yaml.load(texto)
    assert.equal(doc['llm-pi-ai'].providers.openweights.baseURL, 'http://127.0.0.1:9/v1')
    assert.equal(doc['llm-pi-ai'].providers.openweights.apiKeyEnv, 'OPENWEIGHTS_API_KEY')
    assert.deepEqual(doc['agent-default-model'], { provider: 'openweights', model: 'qwen3-8b' })
    assert.ok(!mensagens.some((m) => m.type === 'catalog-error'), JSON.stringify(mensagens))
  })
})
