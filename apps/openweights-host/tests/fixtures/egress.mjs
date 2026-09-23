// Registra toda conexão TCP de saída e toda consulta DNS do processo (stderr, prefixo EGRESS). Carregado com --import pelo teste de composição.
import dc from 'node:diagnostics_channel'
import dns from 'node:dns'
const log = (...a) => process.stderr.write(`EGRESS ${a.join(' ')}\n`)
dc.subscribe('net.client.socket', ({ socket }) => {
  socket.once('connect', () => log('tcp', `${socket.remoteAddress}:${socket.remotePort}`))
  socket.once('lookup', (_e, addr, _f, host) => log('lookup-socket', host ?? '?', addr ?? ''))
})
for (const fn of ['lookup']) {
  const orig = dns[fn]
  dns[fn] = function (host, ...rest) { log('dns', host); return orig.call(this, host, ...rest) }
}
const origResolve = dns.promises.lookup
dns.promises.lookup = function (host, ...rest) { log('dns-p', host); return origResolve.call(this, host, ...rest) }
