/**
 * Compatibilidade do cliente web com os webviews que o OpenWeights usa.
 *
 * O cliente do upstream usa os Iterator helpers do ES2025 (`Iterator`,
 * `.values().some(...)`, `.keys().filter(...)`, `.entries().flatMap(...)`),
 * que o WKWebView só traz a partir do Safari 18.4: no macOS 14 o cliente
 * inteiro falha ao carregar ("Can't find variable: Iterator"). O polyfill vai
 * no `<head>` como script clássico — roda antes dos módulos do cliente — e só
 * define o que faltar; num webview atual ele não troca nada.
 * @module @openweights/agenticow-plugins/compat
 */

export const name = 'openweights-compat'

/** Iterator helpers mínimos, em ES2015, sem `</script`. */
export const POLYFILL_ITERATOR = `(function () {
  var P = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
  if (typeof globalThis.Iterator !== 'function') {
    var It = function Iterator() {
      if (new.target === undefined || new.target === It) throw new TypeError('Iterator is abstract');
    };
    It.prototype = P;
    Object.defineProperty(P, 'constructor', { value: It, writable: true, configurable: true });
    It.from = function (o) {
      var it = typeof o[Symbol.iterator] === 'function' ? o[Symbol.iterator]() : o;
      if (P.isPrototypeOf(it)) return it;
      return (function* () { yield* { [Symbol.iterator]: function () { return it; } }; })();
    };
    globalThis.Iterator = It;
  }
  function def(nome, f) {
    if (typeof P[nome] !== 'function') Object.defineProperty(P, nome, { value: f, writable: true, configurable: true });
  }
  def('map', function* (f) { var i = 0; for (var v of this) yield f(v, i++); });
  def('filter', function* (f) { var i = 0; for (var v of this) if (f(v, i++)) yield v; });
  def('take', function* (n) { if (n <= 0) return; var i = 0; for (var v of this) { yield v; if (++i >= n) return; } });
  def('drop', function* (n) { var i = 0; for (var v of this) if (i++ >= n) yield v; });
  def('flatMap', function* (f) { var i = 0; for (var v of this) yield* f(v, i++); });
  def('forEach', function (f) { var i = 0; for (var v of this) f(v, i++); });
  def('some', function (f) { var i = 0; for (var v of this) if (f(v, i++)) return true; return false; });
  def('every', function (f) { var i = 0; for (var v of this) if (!f(v, i++)) return false; return true; });
  def('find', function (f) { var i = 0; for (var v of this) if (f(v, i++)) return v; return undefined; });
  def('toArray', function () { var a = []; for (var v of this) a.push(v); return a; });
  def('reduce', function (f) {
    var i = 0, temInicial = arguments.length > 1, acc = arguments[1];
    for (var v of this) { if (!temInicial) { acc = v; temInicial = true; i++; continue; } acc = f(acc, v, i++); }
    if (!temInicial) throw new TypeError('Reduce of empty iterator with no initial value');
    return acc;
  });
})();`

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.on('webserver/index-inject', (tabela) => {
    tabela.push({ kind: 'script', placement: 'head', text: POLYFILL_ITERATOR })
  })
}
