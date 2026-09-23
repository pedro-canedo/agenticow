// Regras do modelo padrão — os mesmos casos que o app cobria no Rust
// (crates/dshhost/src/settings.rs) quando editava o settings.yaml por fora.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ambienteVivo, padraoPrecisaTrocar, proximoPadrao, trocarChaves } from '../src/catalog.js'

const rotas = {
  openweights: { models: [{ id: 'qwen3-8b', reasoningEfforts: { off: null, high: 'high' } }, { id: 'gemma' }] },
  openrouter: { models: [{ id: 'anthropic/claude' }] },
}

describe('modelo padrão', () => {
  it('ausente → aponta para o primeiro modelo local', () => {
    assert.equal(padraoPrecisaTrocar(undefined, rotas), true)
    assert.deepEqual(proximoPadrao(undefined, rotas), { provider: 'openweights', model: 'qwen3-8b' })
  })

  it('sem modelo local → o primeiro remoto do app; sem modelo nenhum → não inventa', () => {
    assert.deepEqual(proximoPadrao(undefined, { openrouter: rotas.openrouter }), { provider: 'openrouter', model: 'anthropic/claude' })
    assert.deepEqual(proximoPadrao(undefined, { ninerouter: { models: [{ id: 'kimi' }] } }), { provider: 'ninerouter', model: 'kimi' })
    assert.equal(proximoPadrao(undefined, {}), undefined)
    assert.equal(proximoPadrao(undefined, { openweights: { models: [] } }), undefined)
  })

  it('rota gerenciada com modelo que sumiu → troca', () => {
    assert.equal(padraoPrecisaTrocar({ provider: 'openweights', model: 'apagado' }, rotas), true)
  })

  it('rota gerenciada com modelo presente → mantém', () => {
    assert.equal(padraoPrecisaTrocar({ provider: 'openrouter', model: 'anthropic/claude' }, rotas), false)
    assert.equal(proximoPadrao({ provider: 'openrouter', model: 'anthropic/claude' }, rotas), undefined)
  })

  it('o deepseek-official de um home antigo e o padrão da composição → o primeiro modelo do app', () => {
    // A composição do AgenticOw não tem o adaptador da DeepSeek: o cérebro vem do app.
    assert.equal(padraoPrecisaTrocar({ provider: 'deepseek-official', model: 'deepseek-flash' }, rotas), true)
    assert.deepEqual(proximoPadrao({ provider: 'deepseek-official', model: 'deepseek-flash' }, rotas), { provider: 'openweights', model: 'qwen3-8b' })
    assert.deepEqual(proximoPadrao({ provider: 'openweights', model: 'sem-modelo' }, rotas), { provider: 'openweights', model: 'qwen3-8b' })
  })

  it('rota desconhecida (ex.: o "openai" de versões antigas) → troca', () => {
    assert.equal(padraoPrecisaTrocar({ provider: 'openai', model: 'gpt' }, rotas), true)
  })

  it('esforço não declarado pelo modelo sai; off e declarado ficam', () => {
    assert.deepEqual(proximoPadrao({ provider: 'openweights', model: 'gemma', reasoningEffort: 'high' }, rotas), { provider: 'openweights', model: 'gemma' })
    assert.equal(proximoPadrao({ provider: 'openweights', model: 'gemma', reasoningEffort: 'off' }, rotas), undefined)
    assert.equal(proximoPadrao({ provider: 'openweights', model: 'qwen3-8b', reasoningEffort: 'high' }, rotas), undefined)
  })

  it('esforço declarado num modelo remoto fica; o de um modelo que sumiu vai junto com ele', () => {
    const comEsforco = { ...rotas, openrouter: { models: [{ id: 'anthropic/claude', reasoningEfforts: { high: 'high' } }] } }
    assert.equal(proximoPadrao({ provider: 'openrouter', model: 'anthropic/claude', reasoningEffort: 'high' }, comEsforco), undefined)
    assert.deepEqual(proximoPadrao({ provider: 'deepseek-official', model: 'v4', reasoningEffort: 'max' }, rotas), { provider: 'openweights', model: 'qwen3-8b' })
  })
})

// O retrato do ambiente como o upstream o monta: camadas por ordem de
// confiança, congeladas na subida.
function retratoCongelado(camadas) {
  const ordem = ['process', 'project-env', 'user-env']
  const getFrom = (name, sources) => {
    for (const source of ordem) {
      if (!sources.includes(source)) continue
      const value = camadas[source]?.[name]
      if (value !== undefined) return { value, source }
    }
    return undefined
  }
  return { get: (name) => getFrom(name, ordem), getFrom }
}

describe('chaves do app no ambiente', () => {
  it('a camada process consulta antes as chaves do app, sem apagar o resto', () => {
    const retrato = retratoCongelado({ process: { HOME: '/h' }, 'user-env': { DEEPSEEK_API_KEY: 'sk-ds' } })
    const memoria = new Map()
    assert.equal(ambienteVivo(retrato, memoria), true)
    assert.equal(retrato.getFrom('OPENWEIGHTS_API_KEY', ['process']), undefined)
    memoria.set('OPENWEIGHTS_API_KEY', 'local')
    assert.deepEqual(retrato.getFrom('OPENWEIGHTS_API_KEY', ['process']), { value: 'local', source: 'process' })
    assert.deepEqual(retrato.get('OPENWEIGHTS_API_KEY'), { value: 'local', source: 'process' })
    assert.equal(retrato.getFrom('OPENWEIGHTS_API_KEY', ['user-env']), undefined, 'fora da camada process a memória não vale')
    assert.deepEqual(retrato.get('HOME'), { value: '/h', source: 'process' })
    assert.deepEqual(retrato.get('DEEPSEEK_API_KEY'), { value: 'sk-ds', source: 'user-env' })
  })

  it('sem retrato não faz nada', () => {
    assert.equal(ambienteVivo(undefined, new Map()), false)
  })

  it('cada catálogo troca as chaves: a que não veio sai, nome estranho não entra', () => {
    const memoria = new Map()
    trocarChaves({ OPENWEIGHTS_API_KEY: 'local', OPENROUTER_API_KEY: 'sk-or', PATH: '/x', NINEROUTER_API_KEY: '' }, memoria)
    assert.deepEqual([...memoria.keys()].sort(), ['OPENROUTER_API_KEY', 'OPENWEIGHTS_API_KEY'])
    assert.equal(process.env.OPENROUTER_API_KEY, 'sk-or')
    trocarChaves({ OPENWEIGHTS_API_KEY: 'sk-nova' }, memoria)
    assert.deepEqual([...memoria], [['OPENWEIGHTS_API_KEY', 'sk-nova']])
    assert.equal(process.env.OPENROUTER_API_KEY, undefined)
    trocarChaves({}, memoria)
    assert.equal(memoria.size, 0)
    assert.equal(process.env.OPENWEIGHTS_API_KEY, undefined)
  })
})
