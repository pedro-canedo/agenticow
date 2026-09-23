// Registra cada requisição/upgrade que o servidor HTTP do Host recebe (stderr, prefixo REQ).
import http from 'node:http'
const orig = http.Server.prototype.emit
http.Server.prototype.emit = function (ev, req, res) {
  if (ev === 'request' || ev === 'upgrade') {
    const url = (req.url ?? '').replace(/token=[\w-]+/, 'token=***').slice(0, 900)
    const ck = /dsh-auth-/.test(req.headers.cookie ?? '') ? 'cookie' : 'sem-cookie'
    const tag = ev === 'upgrade' ? 'WS ' : ''
    if (ev === 'request') res.once('finish', () => process.stderr.write(`REQ ${tag}${req.method} ${url} [${ck}] -> ${res.statusCode}\n`))
    else process.stderr.write(`REQ WS-UPGRADE ${url} [${ck}]\n`)
  }
  return orig.apply(this, arguments)
}
