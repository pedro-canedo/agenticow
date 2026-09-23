#!/usr/bin/env node
/**
 * Ponto de entrada do runtime do AgenticOw, supervisionado pelo OpenWeights.
 *
 * Uso: agenticow-host --port <porta>
 *   `DSH_HOME` aponta o home (profiles, sessões, credenciais). O app escolhe a
 *   porta: uma origem estável mantém o cookie de sessão e o armazenamento do
 *   cliente entre reinícios — e `EADDRINUSE` derruba o Host, então quem
 *   escolhe (e tenta outra) é o app.
 *
 * O stdout é o canal de controle (ver `src/canal.mjs`); ele é tomado ANTES de
 * qualquer import do dsh, que só entra por import dinâmico.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { abrirCanal, PROTOCOLO } from '../src/canal.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

function lerJson(caminho) {
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'))
  } catch {
    return undefined
  }
}

function argumento(nome) {
  const i = process.argv.indexOf(nome)
  return i === -1 ? undefined : process.argv[i + 1]
}

// Desligar sempre pelo caminho do próprio CLI: o handler de SIGTERM dele faz o
// dispose da árvore (sessões gravadas, processos filhos encerrados) e sai com 0.
// `process.emit` chama esse handler sem sinal de verdade — no Windows um
// `process.kill(pid, 'SIGTERM')` mataria o processo na hora, sem dispose.
// Antes de o CLI registrar o handler ainda não há nada a descartar.
const canal = abrirCanal({
  aoDesligar: (motivo) => {
    process.stderr.write(`agenticow-host: desligando (${motivo})\n`)
    if (process.listenerCount('SIGTERM') > 0) process.emit('SIGTERM', 'SIGTERM')
    else process.exit(0)
  },
})

const require = createRequire(import.meta.url)
const identidade = lerJson(join(RAIZ, 'runtime.json')) ?? {}
const host = lerJson(join(RAIZ, 'package.json')) ?? {}
const binDoDsh = require.resolve('@deepseek-ai/dsh/lib/bin.js')
const dsh = lerJson(join(dirname(binDoDsh), '..', 'package.json')) ?? {}

canal.enviar('hello', {
  protocol: PROTOCOLO,
  host: host.version ?? '0.0.0',
  revision: identidade.revision ?? 'dev',
  upstreamTag: identidade.upstreamTag ?? 'dev',
  dsh: dsh.version ?? '0.0.0',
  node: process.version,
  nodeAbi: process.versions.modules,
  pid: process.pid,
})

// Segunda trava da telemetria do upstream (a primeira é a linha desativada no
// patch do bundle): nada de log de sessão para a DeepSeek.
process.env.DSH_TELEMETRY_DISABLED ||= '1'

const porta = argumento('--port') ?? '0'
if (!/^\d{1,5}$/.test(porta) || Number(porta) > 65535) {
  canal.fatal(`porta inválida: ${porta}`)
  process.exit(2)
}

try {
  const { garantirPerfil, NOME_DO_PERFIL } = await import('../src/perfil.mjs')
  const perfil = garantirPerfil(process.env.DSH_HOME || undefined)
  if (perfil.corrigido) process.stderr.write(`agenticow-host: profile corrigido em ${perfil.dir}\n`)

  process.argv = [
    process.execPath, binDoDsh,
    '--profile', NOME_DO_PERFIL,
    '--host', '127.0.0.1',
    '--port', porta,
    '--no-open',
  ]
  const { runCli } = await import(pathToFileURL(binDoDsh).href)
  await runCli()
} catch (error) {
  canal.fatal(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exitCode = 1
}
