/**
 * O catálogo de modelos do OpenWeights dentro do AgenticOw.
 *
 * O app empurra `{"type": "catalog", "revision", "piAi", "env"}` sempre que
 * algo muda (motor sobe ou desce, modelo baixado ou apagado, Jev ligado,
 * favoritos do OpenRouter, 9router). Aqui:
 *
 *   1. `env` — as chaves de API (`*_API_KEY`) vão para o ambiente DESTE
 *      processo, em memória: o adaptador as lê por requisição pelo nome
 *      (`apiKeyEnv`), então trocar uma chave não exige reiniciar, e nenhuma
 *      chave toca arquivo;
 *   2. `piAi` — a seção `llm-pi-ai` inteira, montada pelo app, substitui a do
 *      usuário pela API de configurações (com validação de schema — uma
 *      mudança do upstream quebra no teste, não na máquina de alguém);
 *   3. o modelo padrão é reparado só quando está ausente ou quebrado, e um
 *      esforço de raciocínio que o modelo não aceita sai — as mesmas regras
 *      que o app aplicava editando o settings.yaml por fora.
 *
 * Responde `{"type": "catalog-applied", "revision"}` ou `catalog-error`.
 * @module @openweights/agenticow-plugins/catalog
 */

export const name = 'openweights-catalog'
export const inject = ['settings']

const CANAL = Symbol.for('openweights.agenticow.control')

/** Rotas que o OpenWeights gerencia; qualquer outra é da pessoa. */
export const ROTAS_GERENCIADAS = Object.freeze(['openweights', 'openrouter', 'ninerouter'])

/** Provedor nativo do upstream: uma escolha da pessoa, nunca tocada. */
const PROVEDOR_NATIVO = 'deepseek-official'

const NOME_DE_CHAVE = /^[A-Z][A-Z0-9_]*_API_KEY$/

/**
 * @typedef {{ id: string, reasoningEfforts?: Record<string, unknown> }} Modelo
 * @typedef {{ models?: Modelo[] }} Rota
 * @typedef {{ provider?: string, model?: string, reasoningEffort?: string }} Padrao
 */

/**
 * O padrão precisa ser trocado? Mexe SÓ quando está ausente ou aponta para
 * uma rota quebrada — nunca por cima de uma escolha válida.
 * @param {Padrao | undefined} atual - a camada do usuário (não o valor resolvido).
 * @param {Record<string, Rota>} rotas
 */
export function padraoPrecisaTrocar(atual, rotas) {
  if (atual === undefined || typeof atual.provider !== 'string' || typeof atual.model !== 'string') return true
  if (ROTAS_GERENCIADAS.includes(atual.provider)) {
    return !(rotas[atual.provider]?.models ?? []).some((m) => m.id === atual.model)
  }
  if (atual.provider === PROVEDOR_NATIVO || rotas[atual.provider] !== undefined) return false
  return true
}

/**
 * O próximo padrão (ou undefined para não mexer).
 * @param {Padrao | undefined} atual
 * @param {Record<string, Rota>} rotas
 * @returns {Padrao | undefined}
 */
export function proximoPadrao(atual, rotas) {
  if (padraoPrecisaTrocar(atual, rotas)) {
    // O reset aponta para o primeiro modelo local; sem modelo local, não inventa.
    const primeiro = rotas.openweights?.models?.[0]
    return primeiro === undefined ? undefined : { provider: 'openweights', model: primeiro.id }
  }
  // Esforço que o modelo da rota gerenciada não declarou sai; `off` é sempre aceito.
  const { provider, model, reasoningEffort } = /** @type {Padrao} */ (atual)
  if (reasoningEffort === undefined || reasoningEffort === 'off' || !ROTAS_GERENCIADAS.includes(provider ?? '')) return undefined
  const modelo = (rotas[provider ?? '']?.models ?? []).find((m) => m.id === model)
  if (modelo === undefined) return undefined
  if (Object.keys(modelo.reasoningEfforts ?? {}).includes(reasoningEffort)) return undefined
  return { provider, model }
}

/**
 * Aplica um catálogo.
 * @param {{ settings: any }} ctx
 * @param {{ piAi?: { providers?: Record<string, Rota> }, env?: Record<string, unknown> }} msg
 */
export async function aplicarCatalogo(ctx, msg) {
  for (const [nome, valor] of Object.entries(msg.env ?? {})) {
    if (!NOME_DE_CHAVE.test(nome)) continue
    if (typeof valor === 'string' && valor !== '') process.env[nome] = valor
    else delete process.env[nome]
  }
  const piAi = msg.piAi ?? { providers: {} }
  await ctx.settings.replace('llm-pi-ai', piAi)
  const rotas = piAi.providers ?? {}
  const descritor = ctx.settings.describe().find((d) => d.ns === 'agent-default-model')
  const atual = descritor?.user !== null && typeof descritor?.user === 'object' ? descritor.user : undefined
  const proximo = proximoPadrao(atual, rotas)
  if (proximo !== undefined) await ctx.settings.replace('agent-default-model', proximo)
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const canal = globalThis[CANAL]
  if (canal === undefined) return

  let assentou = false
  let pendente
  let fila = Promise.resolve()
  const aplicar = (msg) => {
    fila = fila.then(() => aplicarCatalogo(ctx, msg)).then(
      () => { canal.enviar('catalog-applied', { revision: msg.revision ?? null }) },
      (error) => {
        const message = error instanceof Error ? error.message : String(error)
        process.stderr.write(`openweights-catalog: catálogo recusado: ${message}\n`)
        canal.enviar('catalog-error', { revision: msg.revision ?? null, message })
      },
    )
  }
  // `llm-pi-ai` e `agent-default-model` são registrados por outras linhas da
  // árvore; o catálogo só é aplicado depois que ela assenta. Enquanto isso,
  // vale o último recebido.
  canal.on('catalog', (msg) => {
    if (assentou) aplicar(msg)
    else pendente = msg
  })
  const settled = ctx.get('loader')?.await() ?? Promise.resolve()
  settled.then(() => {
    assentou = true
    if (pendente !== undefined) aplicar(pendente)
  }, () => {})
}
