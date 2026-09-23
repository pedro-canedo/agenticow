// O polyfill de Iterator helpers num ambiente SEM eles (o Node 22 já os traz;
// aqui eles são apagados antes), como o WKWebView do macOS 14.
import assert from 'node:assert/strict'
import { it } from 'node:test'
import vm from 'node:vm'
import { POLYFILL_ITERATOR } from '../src/compat.js'

function ambienteSemIteratorHelpers() {
  const ctx = vm.createContext({})
  vm.runInContext(`
    const P = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
    for (const n of ['map','filter','take','drop','flatMap','forEach','some','every','find','toArray','reduce']) delete P[n];
    delete globalThis.Iterator;
  `, ctx)
  return ctx
}

it('define Iterator e os helpers que o cliente usa', () => {
  const ctx = ambienteSemIteratorHelpers()
  assert.equal(vm.runInContext('typeof Iterator', ctx), 'undefined')
  vm.runInContext(POLYFILL_ITERATOR, ctx)
  const r = vm.runInContext(`({
    tipo: typeof Iterator,
    some: new Map([[1, 'a'], [2, 'b']]).values().some((v) => v === 'b'),
    filter: [...new Set([1, 2, 3, 4]).keys().filter((v) => v % 2 === 0)],
    find: new Map([['x', 1], ['y', 2]]).keys().find((k) => k === 'y'),
    flatMap: [...new Map([['a', [1, 2]], ['b', [3]]]).entries().flatMap(([, v]) => v)],
    mapTake: [1, 2, 3, 4][Symbol.iterator]().map((v) => v * 10).take(2).toArray(),
    reduce: [1, 2, 3][Symbol.iterator]().reduce((a, b) => a + b),
    joinPatchavel: (Iterator.prototype.join = function (s) { return [...this].join(s) }, [1, 2][Symbol.iterator]().join('-')),
  })`, ctx)
  assert.deepEqual({ ...r, filter: [...r.filter], flatMap: [...r.flatMap], mapTake: [...r.mapTake] }, {
    tipo: 'function', some: true, filter: [2, 4], find: 'y', flatMap: [1, 2, 3], mapTake: [10, 20], reduce: 6, joinPatchavel: '1-2',
  })
})

it('não troca nada onde os helpers já existem', () => {
  const ctx = vm.createContext({})
  const antes = vm.runInContext('[Iterator, Iterator.prototype.map]', ctx)
  vm.runInContext(POLYFILL_ITERATOR, ctx)
  const depois = vm.runInContext('[Iterator, Iterator.prototype.map]', ctx)
  assert.equal(depois[0], antes[0])
  assert.equal(depois[1], antes[1])
})
