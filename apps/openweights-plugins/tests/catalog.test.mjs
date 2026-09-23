// Regras do modelo padrão — os mesmos casos que o app cobria no Rust
// (crates/dshhost/src/settings.rs) quando editava o settings.yaml por fora.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { padraoPrecisaTrocar, proximoPadrao } from '../src/catalog.js'

const rotas = {
  openweights: { models: [{ id: 'qwen3-8b', reasoningEfforts: { off: null, high: 'high' } }, { id: 'gemma' }] },
  openrouter: { models: [{ id: 'anthropic/claude' }] },
}

describe('modelo padrão', () => {
  it('ausente → aponta para o primeiro modelo local', () => {
    assert.equal(padraoPrecisaTrocar(undefined, rotas), true)
    assert.deepEqual(proximoPadrao(undefined, rotas), { provider: 'openweights', model: 'qwen3-8b' })
  })

  it('sem modelo local → não inventa', () => {
    assert.equal(proximoPadrao(undefined, { openrouter: rotas.openrouter }), undefined)
  })

  it('rota gerenciada com modelo que sumiu → troca', () => {
    assert.equal(padraoPrecisaTrocar({ provider: 'openweights', model: 'apagado' }, rotas), true)
  })

  it('rota gerenciada com modelo presente → mantém', () => {
    assert.equal(padraoPrecisaTrocar({ provider: 'openrouter', model: 'anthropic/claude' }, rotas), false)
    assert.equal(proximoPadrao({ provider: 'openrouter', model: 'anthropic/claude' }, rotas), undefined)
  })

  it('provedor nativo do upstream ou rota da pessoa → nunca toca', () => {
    assert.equal(padraoPrecisaTrocar({ provider: 'deepseek-official', model: 'x' }, rotas), false)
    assert.equal(padraoPrecisaTrocar({ provider: 'minha-rota', model: 'y' }, { ...rotas, 'minha-rota': { models: [] } }), false)
  })

  it('rota desconhecida (ex.: o "openai" de versões antigas) → troca', () => {
    assert.equal(padraoPrecisaTrocar({ provider: 'openai', model: 'gpt' }, rotas), true)
  })

  it('esforço não declarado pelo modelo sai; off e declarado ficam', () => {
    assert.deepEqual(proximoPadrao({ provider: 'openweights', model: 'gemma', reasoningEffort: 'high' }, rotas), { provider: 'openweights', model: 'gemma' })
    assert.equal(proximoPadrao({ provider: 'openweights', model: 'gemma', reasoningEffort: 'off' }, rotas), undefined)
    assert.equal(proximoPadrao({ provider: 'openweights', model: 'qwen3-8b', reasoningEffort: 'high' }, rotas), undefined)
  })

  it('esforço fora de rota gerenciada é da pessoa', () => {
    assert.equal(proximoPadrao({ provider: 'deepseek-official', model: 'v4', reasoningEffort: 'max' }, rotas), undefined)
  })
})
