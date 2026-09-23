// A UI do AgenticOw num navegador de verdade (WebKit do Playwright por padrão —
// o mesmo motor do webview do Linux e do macOS), contra um runtime EMPACOTADO.
//
//   AGENTICOW_RUNTIME=<dir> [AGENTICOW_ENGINE=webkit] node --test tests/*.test.mjs
// Requer o navegador do Playwright instalado (`playwright install --with-deps webkit`).

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const RUNTIME = process.env.AGENTICOW_RUNTIME
const ENGINE = process.env.AGENTICOW_ENGINE ?? 'webkit'
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function playwright() {
  const loja = join(REPO, 'node_modules', '.pnpm')
  const pasta = existsSync(loja) ? readdirSync(loja).find((n) => /^playwright@\d/.test(n)) : undefined
  if (pasta === undefined) return undefined
  return createRequire(join(loja, pasta, 'node_modules', 'playwright', 'package.json'))('playwright')
}
const pw = RUNTIME === undefined ? undefined : playwright()
const pular = RUNTIME === undefined ? 'defina AGENTICOW_RUNTIME' : pw === undefined ? 'playwright não instalado na workspace' : false

const homes = []
after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }) })

/**
 * @param {string} locale
 * @param {(page: any) => Promise<void>} [acao] - o que fazer na página antes de ler o texto.
 */
async function abrir(locale, acao) {
  const home = mkdtempSync(join(tmpdir(), 'agenticow-ui-'))
  homes.push(home)
  const host = spawn(process.execPath, [join(RUNTIME, 'bin', 'agenticow-host.mjs'), '--port', '0'], {
    cwd: RUNTIME, env: { ...process.env, DSH_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  host.stderr.on('data', (d) => { stderr += d })
  const ready = await new Promise((ok, falha) => {
    const t = setTimeout(() => falha(new Error(`sem ready\n${stderr.slice(-2000)}`)), 60_000)
    createInterface({ input: host.stdout }).on('line', (l) => { const m = JSON.parse(l); if (m.type === 'ready') { clearTimeout(t); ok(m) } })
  })
  host.stdin.write(JSON.stringify({ ow: 1, type: 'locale', locale }) + '\n')
  await new Promise((r) => setTimeout(r, 1500))
  const browser = await pw[ENGINE].launch()
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  const erros = []
  page.on('pageerror', (e) => erros.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
  await page.goto(ready.url, { waitUntil: 'load' })
  await page.waitForTimeout(8000)
  if (acao !== undefined) await acao(page)
  const r = {
    erros,
    titulo: await page.title(),
    lang: await page.evaluate(() => document.documentElement.lang),
    texto: (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' '),
  }
  await browser.close()
  host.stdin.write(JSON.stringify({ ow: 1, type: 'shutdown' }) + '\n')
  await new Promise((ok) => host.once('exit', ok))
  return r
}

describe(`UI do AgenticOw (${ENGINE})`, { skip: pular }, () => {
  it('em pt-BR: marca, idioma e boas-vindas do AgenticOw', async () => {
    const r = await abrir('pt-BR')
    assert.deepEqual(r.erros, [])
    assert.equal(r.titulo, 'AgenticOw')
    assert.equal(r.lang, 'pt-BR')
    assert.match(r.texto, /Nova sessão/)
    assert.match(r.texto, /Bem-vindo ao AgenticOw/)
    assert.doesNotMatch(r.texto, /DSH|Into the Unknown/)
    // A única menção à DeepSeek é a atribuição da licença.
    assert.deepEqual(r.texto.match(/DeepSeek[^.]*/g), ['DeepSeek Harness (licença MIT) e ainda está em pré-lançamento: recursos, presets e plugins podem mudar de uma versão para outra'])
  })

  it('em inglês: marca do AgenticOw e sem o aviso de testes da DeepSeek', async () => {
    const r = await abrir('en')
    assert.deepEqual(r.erros, [])
    assert.equal(r.titulo, 'AgenticOw')
    assert.equal(r.lang, 'en')
    assert.match(r.texto, /^AgenticOw /)
    assert.doesNotMatch(r.texto, /Internal Testing Notice|DSH Local Build/)
    // O cérebro vem do OpenWeights: nada de pedir a chave da DeepSeek.
    assert.doesNotMatch(r.texto, /API key|DeepSeek/)
  })

  it('em pt-BR, depois das boas-vindas não pede chave de provedor nenhum', async () => {
    const r = await abrir('pt-BR', async (page) => {
      await page.getByRole('button', { name: 'Continuar' }).click()
      await page.waitForTimeout(1500)
    })
    assert.deepEqual(r.erros, [])
    assert.doesNotMatch(r.texto, /Bem-vindo ao AgenticOw/)
    assert.doesNotMatch(r.texto, /chave de API|provedor oficial da DeepSeek/)
  })

  it('a página de Modelos diz que os modelos vêm do OpenWeights', async () => {
    const r = await abrir('en', async (page) => {
      await page.getByText('Settings', { exact: true }).first().click()
      await page.waitForTimeout(1000)
      await page.getByText('Models', { exact: true }).first().click()
      await page.waitForTimeout(1500)
    })
    assert.deepEqual(r.erros, [])
    assert.match(r.texto, /Models come from OpenWeights/)
    assert.doesNotMatch(r.texto, /DeepSeek/)
    // Acrescentar provedor aqui seria substituído pelo catálogo do app.
    assert.doesNotMatch(r.texto, /Add provider|Add a custom provider/)
  })
})
