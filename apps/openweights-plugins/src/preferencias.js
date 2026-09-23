/**
 * Preferências que o OpenWeights empurra para o AgenticOw pelo canal de
 * controle. Hoje: o idioma (`{"type": "locale", "locale": "pt-BR" | "en"}`),
 * gravado como a escolha explícita do seletor de idioma da UI.
 *
 * Em inglês, o aviso de testes do upstream (que fala do DeepSeek Harness) é
 * marcado como visto; em pt-BR ele aparece com o texto do próprio AgenticOw,
 * vindo do dicionário do @openweights/agenticow-ui.
 * @module @openweights/agenticow-plugins/preferencias
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

export const name = 'openweights-preferencias'
export const inject = ['settings']

const CANAL = Symbol.for('openweights.agenticow.control')
const IDIOMAS = new Set(['pt-BR', 'en'])

/**
 * A versão do aviso de boas-vindas vive só no bundle do cliente do
 * ui-settings-models; lida de lá, a marcação acompanha o upstream sozinha. Se
 * o formato mudar, devolve undefined e nada é marcado — um teste de contrato
 * da CI do fork pega isso antes de chegar a alguém.
 * @returns {string | undefined}
 */
export function versaoDoAvisoDeBoasVindas() {
  try {
    const require = createRequire(import.meta.url)
    const arquivo = require.resolve('@deepseek-ai/dsh-client-ui-settings-models/client')
    return /WELCOME_NOTICE_VERSION\s*=\s*"([^"]+)"/.exec(readFileSync(arquivo, 'utf8'))?.[1]
  } catch {
    return undefined
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const canal = globalThis[CANAL]
  if (canal === undefined) return

  let pendente
  let assentou = false
  const aplicar = async (locale) => {
    await ctx.settings.update('locale', { preference: locale })
    if (locale === 'en') {
      const versao = versaoDoAvisoDeBoasVindas()
      if (versao !== undefined) await ctx.settings.update('ui-onboarding', { welcomeNoticeVersion: versao })
    }
  }
  const tentar = (locale) => {
    aplicar(locale).catch((error) => {
      process.stderr.write(`openweights-preferencias: não foi possível aplicar o idioma ${locale}: ${error instanceof Error ? error.message : String(error)}\n`)
    })
  }

  // Os namespaces `locale` e `ui-onboarding` são registrados por outras linhas
  // da árvore; o idioma só é gravado depois que ela assenta.
  canal.on('locale', (msg) => {
    if (typeof msg.locale !== 'string' || !IDIOMAS.has(msg.locale)) return
    if (assentou) tentar(msg.locale)
    else pendente = msg.locale
  })
  const settled = ctx.get('loader')?.await() ?? Promise.resolve()
  settled.then(() => {
    assentou = true
    if (pendente !== undefined) tentar(pendente)
  }, () => {})
}
