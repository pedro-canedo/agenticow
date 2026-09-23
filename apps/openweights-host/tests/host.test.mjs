// Ponta a ponta do runtime: sobe o Host de verdade e fala o protocolo com ele.
//
// Roda contra um runtime EMPACOTADO (a árvore que o app instala), apontado por
// AGENTICOW_RUNTIME — na workspace o bundle @openweights/agenticow-app não é
// alcançável a partir do dsh. Sem a variável, os testes são pulados.
//
//   AGENTICOW_RUNTIME=<dir> node --test tests/*.test.mjs

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { after, describe, it } from 'node:test'

const RUNTIME = process.env.AGENTICOW_RUNTIME
const pular = RUNTIME === undefined ? 'defina AGENTICOW_RUNTIME com um runtime empacotado' : false
const homes = []
after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }) })

function subir() {
  const home = mkdtempSync(join(tmpdir(), 'agenticow-home-'))
  homes.push(home)
  const filho = spawn(process.execPath, [join(RUNTIME, 'bin', 'agenticow-host.mjs'), '--port', '0'], {
    cwd: RUNTIME,
    env: { ...process.env, DSH_HOME: home },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const linhas = []
  const mensagens = []
  let stderr = ''
  filho.stderr.on('data', (d) => { stderr += d })
  const esperas = []
  createInterface({ input: filho.stdout }).on('line', (linha) => {
    linhas.push(linha)
    const msg = JSON.parse(linha)
    mensagens.push(msg)
    for (const e of [...esperas]) if (e.tipo === msg.type) { esperas.splice(esperas.indexOf(e), 1); e.ok(msg) }
  })
  const saida = new Promise((ok) => filho.once('exit', (code, signal) => ok({ code, signal })))
  const esperar = (tipo, ms = 60_000) => {
    const ja = mensagens.find((m) => m.type === tipo)
    if (ja !== undefined) return Promise.resolve(ja)
    return new Promise((ok, falha) => {
      const t = setTimeout(() => falha(new Error(`sem "${tipo}" em ${ms} ms\nstderr:\n${stderr.slice(-2000)}`)), ms)
      esperas.push({ tipo, ok: (m) => { clearTimeout(t); ok(m) } })
      saida.then(({ code }) => { clearTimeout(t); falha(new Error(`o Host saiu (${code}) antes de "${tipo}"\n${stderr.slice(-2000)}`)) })
    })
  }
  return { filho, home, linhas, esperar, saida, stderr: () => stderr }
}

function get(url, cookie) {
  return new Promise((ok, falha) => {
    const req = request(url, { headers: cookie === undefined ? {} : { cookie } }, (res) => {
      res.resume()
      res.once('end', () => ok({ status: res.statusCode, setCookie: res.headers['set-cookie'] ?? [] }))
    })
    req.once('error', falha)
    req.end()
  })
}

async function comPrazo(promessa, ms, oque) {
  let t
  const prazo = new Promise((_, falha) => { t = setTimeout(() => falha(new Error(`${oque} passou de ${ms} ms`)), ms) })
  try { return await Promise.race([promessa, prazo]) } finally { clearTimeout(t) }
}

describe('runtime do AgenticOw', { skip: pular }, () => {
  it('saúda, sobe, autentica por cookie e sai com 0 no shutdown', async () => {
    const h = subir()
    const hello = await h.esperar('hello')
    assert.equal(hello.ow, 1)
    assert.equal(hello.protocol, 1)
    assert.equal(hello.nodeAbi, process.versions.modules)
    assert.match(hello.dsh, /^\d+\.\d+\.\d+/)

    const ready = await h.esperar('ready')
    assert.match(ready.url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+$/)
    assert.equal(new URL(ready.url).port, String(ready.port))

    const base = `http://127.0.0.1:${ready.port}/`
    assert.equal((await get(base)).status, 401, 'sem cookie a raiz é recusada')
    const troca = await get(ready.url)
    assert.equal(troca.status, 303, 'o token de lançamento é trocado por cookie')
    const cookie = troca.setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('dsh-auth-'))
    assert.ok(cookie, 'a troca grava o cookie dsh-auth-*')
    assert.match(troca.setCookie.join(' '), /SameSite=Strict/)
    assert.equal((await get(base, cookie)).status, 200, 'com o cookie a raiz responde')

    const manifesto = JSON.parse(readFileSync(join(h.home, 'profiles', 'openweights', 'package.json'), 'utf8'))
    assert.equal(manifesto.dsh.profile.patchReload, 'startup')
    assert.deepEqual(manifesto.dsh.profile.bundles.slice(0, 3),
      ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@openweights/agenticow-app'])

    h.filho.stdin.write(JSON.stringify({ ow: 1, type: 'shutdown' }) + '\n')
    const fim = await comPrazo(h.saida, 8000, 'o desligamento')
    assert.equal(fim.code, 0)

    // O stdout é só protocolo: toda linha é JSON com a marca, e o token não vaza em outra linha.
    for (const linha of h.linhas) assert.equal(JSON.parse(linha).ow, 1, `linha fora do protocolo: ${linha}`)
    assert.ok(!/dsh web:/.test(h.stderr()), 'a linha humana com a URL não pode sair')
    assert.ok(!h.stderr().includes(new URL(ready.url).searchParams.get('token')), 'o token não pode ir para o log')
  })

  it('sai com 0 quando o app fecha o stdin', async () => {
    const h = subir()
    await h.esperar('ready')
    h.filho.stdin.end()
    const fim = await comPrazo(h.saida, 8000, 'o desligamento por EOF')
    assert.equal(fim.code, 0)
  })

  it('recusa porta inválida com fatal e código 2', async () => {
    const home = mkdtempSync(join(tmpdir(), 'agenticow-home-'))
    homes.push(home)
    const filho = spawn(process.execPath, [join(RUNTIME, 'bin', 'agenticow-host.mjs'), '--port', '70000'], {
      cwd: RUNTIME, env: { ...process.env, DSH_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    filho.stdout.on('data', (d) => { out += d })
    const { code } = await new Promise((ok) => filho.once('exit', (c) => ok({ code: c })))
    assert.equal(code, 2)
    const tipos = out.trim().split('\n').map((l) => JSON.parse(l).type)
    assert.deepEqual(tipos, ['hello', 'fatal'])
  })
})
