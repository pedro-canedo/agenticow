#!/usr/bin/env node
/**
 * Extrai os dicionários em inglês que a UI do upstream registra, exatamente
 * como o navegador os recebe: executa cada bundle de cliente já compilado
 * (`packages/client/<pacote>/lib/client.js`) com um `window.__ModuleLoader__`
 * e um `ctx` falsos que aceitam qualquer chamada e capturam
 * `ctx.locale.register(ns, { en, zh })`.
 *
 *   node apps/openweights-ui/scripts/extrair-dicionarios.mjs > en.json
 *
 * Requer o build da workspace (`pnpm run build`). A saída alimenta a medição de
 * cobertura do pt-BR e a revisão de traduções a cada sincronização com o upstream.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CLIENTES = join(REPO, 'packages', 'client')
// O React de verdade roda no Node sem DOM; os bundles só chamam memo/forwardRef/
// createContext no nível do módulo, e um proxy embrulhado por __toESM perde tudo.
const requireCliente = createRequire(join(CLIENTES, 'ui-chat', 'package.json'))
const REAIS = new Map(['react', 'react/jsx-runtime'].map((id) => [id, requireCliente(id)]))
// Erros assíncronos dos componentes chamados pelo proxy não interessam aqui.
process.on('uncaughtException', () => {})
process.on('unhandledRejection', () => {})

/** Um objeto que aceita qualquer acesso e qualquer chamada. */
function universal(nome = 'u') {
  const alvo = function () {}
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => nome
      if (prop === Symbol.iterator) return function* () {}
      if (prop === 'then') return undefined
      return universal(`${nome}.${String(prop)}`)
    },
    apply(_t, _this, args) {
      for (const a of args) if (typeof a === 'function') { try { a(universal('cb')) } catch { /* ignora */ } }
      return universal(`${nome}()`)
    },
    construct() { return universal(`new ${nome}`) },
  })
}

const dicionarios = {}
function registrar(ns, localeOuDicts, dict) {
  const nome = String(ns)
  if (typeof localeOuDicts === 'string') {
    if (localeOuDicts === 'en') dicionarios[nome] = { ...(dicionarios[nome] ?? {}), ...dict }
  } else if (localeOuDicts?.en !== undefined) {
    dicionarios[nome] = { ...(dicionarios[nome] ?? {}), ...localeOuDicts.en }
  }
  return () => {}
}

function ctxFalso() {
  const base = universal('ctx')
  const locale = new Proxy(universal('ctx.locale'), {
    get(t, prop) { return prop === 'register' ? registrar : Reflect.get(t, prop) },
  })
  const ctx = new Proxy(base, {
    get(t, prop) {
      if (prop === 'locale') return locale
      if (prop === 'effect') return (fn) => { try { fn() } catch { /* ignora */ } return () => {} }
      if (prop === 'inject') return (_deps, fn) => { try { fn(ctx) } catch { /* ignora */ } }
      if (prop === 'get') return (nome) => (nome === 'locale' ? locale : universal(`get(${String(nome)})`))
      return Reflect.get(t, prop)
    },
  })
  return ctx
}

const falhas = []
for (const pacote of readdirSync(CLIENTES).sort()) {
  const arquivo = join(CLIENTES, pacote, 'lib', 'client.js')
  if (!existsSync(arquivo)) continue
  const codigo = readFileSync(arquivo, 'utf8')
  if (!codigo.includes('locale')) continue
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          const exportado = factory((id) => REAIS.get(id) ?? universal(`require(${id})`))
          if (typeof exportado?.apply === 'function') exportado.apply(ctxFalso(), universal('config'))
        },
      },
    },
    document: universal('document'),
    navigator: { language: 'en' },
    console: { log() {}, warn() {}, error() {} },
    AbortController, TextEncoder, TextDecoder, URL, URLSearchParams,
    setTimeout, clearTimeout, queueMicrotask, structuredClone,
    globalThis: undefined,
  }
  sandbox.globalThis = sandbox
  try {
    vm.runInNewContext(codigo, sandbox, { filename: arquivo, timeout: 5000 })
  } catch (error) {
    falhas.push(`${pacote}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// O pacote locale registra `common` e `settings.locale` num serviço que ele mesmo
// cria — invisível ao ctx falso. Os dois dicionários são objetos literais em TS;
// o TypeScript da workspace os transpila.
const ts = createRequire(join(REPO, 'package.json'))('typescript')
function objetoDoFonte(arquivo, exportado) {
  const js = ts.transpileModule(readFileSync(arquivo, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const modulo = { exports: {} }
  vm.runInNewContext(js, { module: modulo, exports: modulo.exports, require: () => ({}) })
  return modulo.exports[exportado]
}
const LOCALE = join(CLIENTES, 'locale', 'src')
const origemLocale = readFileSync(join(LOCALE, 'client', 'index.ts'), 'utf8')
const nsComum = /export const COMMON_NS = '([^']+)'/.exec(origemLocale)?.[1]
const nsConfig = /export const SETTINGS_NS = '([^']+)'/.exec(origemLocale)?.[1]
if (nsComum === undefined || nsConfig === undefined) falhas.push('locale: constantes COMMON_NS/SETTINGS_NS não encontradas')
else {
  dicionarios[nsComum] = objetoDoFonte(join(LOCALE, 'locales', 'en.ts'), 'en')
  const importSettings = /import \{[^}]*\ben as settingsEn\b[^}]*\} from '([^']+)'/.exec(origemLocale)?.[1]
  if (importSettings === undefined) falhas.push('locale: import do dicionário de settings não encontrado')
  else dicionarios[nsConfig] = objetoDoFonte(join(LOCALE, 'client', importSettings.replace(/\.js$/, '.ts')), 'en')
}

// O ui-theme quebra na própria lógica de preferência antes de registrar; o
// dicionário dele é lido do fonte, pelo namespace que o client/index.ts declara.
{
  const TEMA = join(CLIENTES, 'ui-theme', 'src', 'client')
  const origem = readFileSync(join(TEMA, 'index.ts'), 'utf8')
  const ns = /const SETTINGS_NS = '([^']+)'/.exec(origem)?.[1]
  if (ns === undefined) falhas.push('ui-theme: SETTINGS_NS não encontrado')
  else {
    dicionarios[ns] = { ...(dicionarios[ns] ?? {}), ...objetoDoFonte(join(TEMA, 'locales.ts'), 'en') }
    const i = falhas.findIndex((f) => f.startsWith('ui-theme:'))
    if (i !== -1) falhas.splice(i, 1)
  }
}

const total = Object.values(dicionarios).reduce((n, d) => n + Object.keys(d).length, 0)
process.stderr.write(`${Object.keys(dicionarios).length} namespaces, ${total} strings\n`)
if (falhas.length > 0) process.stderr.write(`falhas (${falhas.length}):\n  ${falhas.join('\n  ')}\n`)
process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(dicionarios).sort(([a], [b]) => a.localeCompare(b))), undefined, 2) + '\n')
