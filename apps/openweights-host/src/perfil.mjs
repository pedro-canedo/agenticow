/**
 * O profile "openweights": dsh-base → dsh-web-app → @openweights/agenticow-app,
 * com `patchReload: "startup"`.
 *
 * `startup` não é gosto: o recarregamento ao vivo do patch do usuário exige o
 * serviço de HMR do Cordis e não serve a um runtime supervisionado, que é
 * reiniciado pelo app quando a configuração muda. Um profile criado por fora
 * (ou por uma versão anterior) tem estes dois campos corrigidos a cada boot; o
 * resto do manifesto — dependências de plugins, por exemplo — fica como está.
 * @module @openweights/agenticow-host/perfil
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'

export const NOME_DO_PERFIL = 'openweights'

export const BUNDLES = Object.freeze([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@openweights/agenticow-app',
])

export const PATCH_RELOAD = 'startup'

/**
 * Garante o profile e devolve o diretório dele.
 * @param {string} [home] - `$DSH_HOME`; padrão: o que o dsh resolveria.
 * @returns {{ dir: string, criado: boolean, corrigido: boolean }}
 */
export function garantirPerfil(home) {
  const dir = resolveProfileDir(NOME_DO_PERFIL, home)
  const manifesto = join(dir, 'package.json')
  const existia = existsSync(manifesto)
  initProfile(dir, BUNDLES, PATCH_RELOAD)
  if (!existia) return { dir, criado: true, corrigido: false }

  const atual = JSON.parse(readFileSync(manifesto, 'utf8'))
  const perfil = atual?.dsh?.profile ?? {}
  const existentes = Array.isArray(perfil.bundles) ? perfil.bundles.filter((b) => typeof b === 'string') : []
  // Os nossos três primeiro e na ordem; plugins que o dsh acrescentou depois
  // (`dsh plugin`) continuam no fim da pilha.
  const bundlesOk = BUNDLES.every((b, i) => existentes[i] === b)
  if (bundlesOk && perfil.patchReload === PATCH_RELOAD) return { dir, criado: false, corrigido: false }

  const extras = existentes.filter((b) => !BUNDLES.includes(b))
  atual.dsh = { ...(atual.dsh ?? {}), profile: { ...perfil, bundles: [...BUNDLES, ...extras], patchReload: PATCH_RELOAD } }
  writeFileSync(manifesto, JSON.stringify(atual, undefined, 2) + '\n')
  return { dir, criado: false, corrigido: true }
}
