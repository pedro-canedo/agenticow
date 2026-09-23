#!/usr/bin/env node
/**
 * Gera o `client.js` do @openweights/agenticow-ui: o modelo em
 * src/cliente.template.js + os dicionários src/pt-BR/<namespace>.json + a marca
 * assets/mark.svg. O artefato é o formato que o carregador de módulos do
 * cliente espera (`window.__ModuleLoader__.load({ id, factory })`), sem etapa
 * de build no runtime.
 *
 *   node scripts/gerar-cliente.mjs           escreve client.js
 *   node scripts/gerar-cliente.mjs --check   falha se o client.js não estiver em dia
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const PT = join(RAIZ, 'src', 'pt-BR')

const dicionarios = {}
for (const arquivo of readdirSync(PT).filter((n) => n.endsWith('.json')).sort()) {
  const ns = arquivo.slice(0, -'.json'.length)
  const dict = JSON.parse(readFileSync(join(PT, arquivo), 'utf8'))
  for (const [chave, valor] of Object.entries(dict)) {
    if (typeof valor !== 'string') throw new Error(`${arquivo}: "${chave}" não é texto`)
  }
  dicionarios[ns] = dict
}
const svg = readFileSync(join(RAIZ, 'assets', 'mark.svg'))
const marca = `data:image/svg+xml;base64,${svg.toString('base64')}`

const modelo = readFileSync(join(RAIZ, 'src', 'cliente.template.js'), 'utf8')
if (!modelo.includes('__DICIONARIOS__') || !modelo.includes('__MARCA__')) throw new Error('modelo sem os marcadores')
const saida = modelo
  .replace('__DICIONARIOS__', JSON.stringify(dicionarios, undefined, '\t').replace(/\n/g, '\n\t\t'))
  .replace('__MARCA__', JSON.stringify(marca))

const destino = join(RAIZ, 'client.js')
if (process.argv.includes('--check')) {
  const atual = existsSync(destino) ? readFileSync(destino, 'utf8') : ''
  if (atual !== saida) {
    process.stderr.write('client.js desatualizado: rode `node apps/openweights-ui/scripts/gerar-cliente.mjs`\n')
    process.exit(1)
  }
  process.stdout.write('client.js em dia\n')
} else {
  writeFileSync(destino, saida)
  const total = Object.values(dicionarios).reduce((n, d) => n + Object.keys(d).length, 0)
  process.stdout.write(`client.js: ${Object.keys(dicionarios).length} namespaces, ${total} strings pt-BR\n`)
}
