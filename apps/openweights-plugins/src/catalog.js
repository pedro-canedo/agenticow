/**
 * O catálogo de modelos do OpenWeights dentro do AgenticOw.
 *
 * O app empurra `{"type": "catalog", "revision", "piAi", "env"}` sempre que
 * algo muda (motor sobe ou desce, modelo baixado ou apagado, Jev ligado,
 * favoritos do OpenRouter, 9router). Aqui:
 *
 *   1. `env` — as chaves de API (`*_API_KEY`) ficam na memória DESTE
 *      processo. O adaptador as pede ao serviço de credenciais pelo nome
 *      (`apiKeyEnv`), a cada requisição; só que o serviço lê o ambiente num
 *      retrato congelado na subida (`launchEnvironment`), e o que chega pelo
 *      canal depois disso ele não veria. Por isso a camada `process` desse
 *      retrato passa a consultar antes as chaves do app (`ambienteVivo`) —
 *      para o serviço elas são ambiente herdado, que é o que são: somente
 *      leitura na UI, trocadas sem reiniciar, nunca em arquivo;
 *   2. `piAi` — a seção `llm-pi-ai` inteira, montada pelo app, substitui a do
 *      usuário pela API de configurações (com validação de schema — uma
 *      mudança do upstream quebra no teste, não na máquina de alguém);
 *   3. o modelo padrão é reparado só quando está ausente ou quebrado, e um
 *      esforço de raciocínio que o modelo não aceita sai. O cérebro vem sempre
 *      do app: a composição não tem outro provedor, então padrão fora das rotas
 *      do catálogo (inclusive o `deepseek-official` de homes antigos) é quebrado.
 *
 * Responde `{"type": "catalog-applied", "revision"}` ou `catalog-error`.
 * @module @openweights/agenticow-plugins/catalog
 */

export const name = 'openweights-catalog'
export const inject = ['settings']

const CANAL = Symbol.for('openweights.agenticow.control')

/** Rotas que o OpenWeights gerencia; qualquer outra é da pessoa. */
export const ROTAS_GERENCIADAS = Object.freeze(['openweights', 'openrouter', 'ninerouter'])


const NOME_DE_CHAVE = /^[A-Z][A-Z0-9_]*_API_KEY$/

/** A chave de contexto do retrato do ambiente (`DSH_LAUNCH_ENVIRONMENT_KEY`). */
const AMBIENTE = 'launchEnvironment'

/** As chaves que o app entregou, só em memória. */
const CHAVES = new Map()

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
  return !(rotas[atual.provider]?.models ?? []).some((m) => m.id === atual.model)
}

/**
 * O próximo padrão (ou undefined para não mexer).
 * @param {Padrao | undefined} atual
 * @param {Record<string, Rota>} rotas
 * @returns {Padrao | undefined}
 */
export function proximoPadrao(atual, rotas) {
  if (padraoPrecisaTrocar(atual, rotas)) {
    // O reset aponta para o primeiro modelo, na ordem das rotas do app (o local
    // antes dos remotos); sem modelo nenhum, não inventa.
    for (const provider of ROTAS_GERENCIADAS) {
      const primeiro = rotas[provider]?.models?.[0]
      if (primeiro !== undefined) return { provider, model: primeiro.id }
    }
    return undefined
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
 * Faz a camada `process` do retrato do ambiente consultar antes `memoria`.
 * O retrato é um objeto `{ get, getFrom }` e todo consumidor o busca no
 * contexto a cada resolução; um contrato do upstream que mude isso quebra no
 * e2e do catálogo, que confere a chave pelo serviço de credenciais.
 * @param {{ get: Function, getFrom: Function } | undefined} retrato
 * @param {Map<string, string>} memoria
 * @returns {boolean} se o retrato foi encontrado e envolvido.
 */
export function ambienteVivo(retrato, memoria) {
  if (retrato === undefined || retrato === null || typeof retrato.getFrom !== 'function') return false
  const original = retrato.getFrom
  const todas = ['process', 'project-env', 'user-env']
  retrato.getFrom = (name, sources) => {
    if (sources.includes('process')) {
      const valor = memoria.get(name)
      if (valor !== undefined) return { value: valor, source: 'process' }
    }
    return original(name, sources)
  }
  retrato.get = (name) => retrato.getFrom(name, todas)
  return true
}

/**
 * Troca as chaves do app pelas de `env`: a que não veio mais sai.
 * @param {Record<string, unknown>} env
 * @param {Map<string, string>} memoria
 */
export function trocarChaves(env, memoria) {
  const novas = new Map()
  for (const [nome, valor] of Object.entries(env)) {
    if (NOME_DE_CHAVE.test(nome) && typeof valor === 'string' && valor !== '') novas.set(nome, valor)
  }
  for (const nome of memoria.keys()) {
    if (!novas.has(nome)) {
      memoria.delete(nome)
      delete process.env[nome]
    }
  }
  for (const [nome, valor] of novas) {
    memoria.set(nome, valor)
    // Bibliotecas de terceiros ainda leem o process.env direto.
    process.env[nome] = valor
  }
}

/**
 * Aplica um catálogo.
 * @param {{ settings: any, get?: Function }} ctx
 * @param {{ piAi?: { providers?: Record<string, Rota> }, env?: Record<string, unknown> }} msg
 * @param {Map<string, string>} [memoria]
 */
export async function aplicarCatalogo(ctx, msg, memoria = CHAVES) {
  trocarChaves(msg.env ?? {}, memoria)
  // Falha alto: uma chave que o serviço de credenciais não enxerga vira
  // MISSING_CREDENTIAL no primeiro turno, longe de quem pode consertar.
  const credenciais = ctx.get?.('credentials')
  if (credenciais !== undefined) {
    for (const [nome, valor] of memoria) {
      const resolvida = await credenciais.resolve(nome)
      if (resolvida?.value !== valor) throw new Error(`a chave ${nome} não chega ao serviço de credenciais`)
    }
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
  ambienteVivo(ctx.get(AMBIENTE), CHAVES)

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
