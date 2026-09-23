/**
 * Canal de controle entre o OpenWeights e o Host do AgenticOw.
 *
 * Transporte: JSON por linha. O stdout é EXCLUSIVO do protocolo — toda
 * mensagem leva `"ow": PROTOCOLO`, e o app descarta qualquer linha sem essa
 * marca. Tudo o que o dsh ou uma dependência escreveria no stdout é desviado
 * para o stderr, que o app trata como log.
 *
 * Host → app: `hello` (identidade), `ready` (URL autenticada e porta),
 * `fatal` (falha antes ou durante o boot).
 * App → Host: `shutdown`; os demais tipos (`catalog`, `locale`, …) são
 * entregues a quem se registrar com `on()`. O ÚLTIMO comando de cada tipo sem
 * dono fica guardado e é entregue quando o dono aparece — o app pode mandar o
 * catálogo antes de a árvore Cordis terminar de subir.
 *
 * EOF no stdin significa que o app se foi: desliga como num `shutdown`.
 * @module @openweights/agenticow-host/canal
 */

import { createInterface } from 'node:readline'

/** Versão do protocolo. Incompatível → o app recusa na saudação. */
export const PROTOCOLO = 1

/** Chave global onde o canal fica visível aos plugins da árvore. */
export const CANAL = Symbol.for('openweights.agenticow.control')

/**
 * Tira o stdout do alcance de qualquer outro escritor e devolve o escritor do
 * protocolo. Tem de rodar antes de importar o dsh.
 * @returns {(linha: string) => void}
 */
function tomarStdout() {
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = process.stderr.write.bind(process.stderr)
  return (linha) => { original(linha) }
}

/**
 * Cria o canal, publica em `globalThis` e passa a ler o stdin.
 * @param {{ aoDesligar: (motivo: string) => void }} opcoes
 */
export function abrirCanal({ aoDesligar }) {
  const escrever = tomarStdout()
  /** @type {Map<string, (msg: Record<string, unknown>) => void>} */
  const donos = new Map()
  /** @type {Map<string, Record<string, unknown>>} */
  const pendentes = new Map()
  let prontoEnviado = false
  let desligando = false

  const enviar = (tipo, campos = {}) => {
    escrever(JSON.stringify({ ow: PROTOCOLO, type: tipo, ...campos }) + '\n')
  }

  const desligar = (motivo) => {
    if (desligando) return
    desligando = true
    aoDesligar(motivo)
  }

  const receber = (linha) => {
    const texto = linha.trim()
    if (texto === '') return
    let msg
    try {
      msg = JSON.parse(texto)
    } catch {
      process.stderr.write(`agenticow-host: linha de controle ignorada (não é JSON): ${texto.slice(0, 120)}\n`)
      return
    }
    if (msg === null || typeof msg !== 'object' || msg.ow !== PROTOCOLO || typeof msg.type !== 'string') {
      process.stderr.write('agenticow-host: mensagem de controle ignorada (sem "ow" compatível ou sem "type")\n')
      return
    }
    if (msg.type === 'shutdown') {
      desligar('shutdown')
      return
    }
    const dono = donos.get(msg.type)
    if (dono === undefined) pendentes.set(msg.type, msg)
    else dono(msg)
  }

  const leitor = createInterface({ input: process.stdin, crlfDelay: Infinity })
  leitor.on('line', receber)
  leitor.on('close', () => { desligar('stdin-fechado') })

  const canal = {
    /** Anuncia a URL autenticada. Só a primeira chamada conta. */
    pronto({ url, port }) {
      if (prontoEnviado) return
      prontoEnviado = true
      enviar('ready', { url, port })
    },
    /** Relata uma falha fatal (o processo vai sair em seguida). */
    fatal(message) {
      enviar('fatal', { message: String(message).slice(0, 4000) })
    },
    /**
     * Registra o dono de um tipo de comando; entrega na hora o último pendente.
     * @param {string} tipo
     * @param {(msg: Record<string, unknown>) => void} dono
     */
    on(tipo, dono) {
      donos.set(tipo, dono)
      const pendente = pendentes.get(tipo)
      if (pendente !== undefined) {
        pendentes.delete(tipo)
        dono(pendente)
      }
    },
    /** Envia uma mensagem livre (usada por plugins; o tipo não pode colidir com os do núcleo). */
    enviar,
  }
  globalThis[CANAL] = canal
  return canal
}
