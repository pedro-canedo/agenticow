/**
 * O canal de controle do AgenticOw dentro da árvore Cordis.
 *
 * O bootstrap do host (`apps/openweights-host`) cria o canal e o publica em
 * `globalThis` antes de subir o dsh; aqui ele ganha acesso aos serviços da
 * árvore. Este plugin anuncia `ready` com a URL autenticada quando o Loader
 * assenta — o mesmo momento em que o web-app imprimiria a linha "dsh web:" —
 * e é o ponto onde os demais plugins do OpenWeights registram os comandos
 * que o app manda.
 *
 * Fora do host do OpenWeights (um `dsh --profile` comum), o canal não existe
 * e o plugin não faz nada.
 * @module @openweights/agenticow-plugins/control
 */

export const name = 'openweights-control'
export const inject = ['connection', 'webServer']

/** Chave global onde o bootstrap publica o canal. */
export const CANAL = Symbol.for('openweights.agenticow.control')

/** Mesmo host que o web-app usa para a URL local. */
const LOOPBACK = '127.0.0.1'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const canal = globalThis[CANAL]
  if (canal === undefined) return

  const anunciar = () => {
    const port = ctx.webServer.port
    const url = ctx.connection.authenticatedUrl(`http://${LOOPBACK}:${String(port)}`)
    canal.pronto({ url, port })
  }

  const assentou = ctx.get('loader')?.await()
  if (assentou === undefined) {
    anunciar()
    return
  }
  assentou.then(() => {
    // A árvore pode ter sido descartada durante o boot (desligamento cedo):
    // anunciar um servidor morto só confundiria o app.
    if (ctx.get('webServer') !== undefined && ctx.get('connection') !== undefined) anunciar()
  }, (error) => {
    canal.fatal(`o boot da árvore falhou: ${error instanceof Error ? error.message : String(error)}`)
  })
}
