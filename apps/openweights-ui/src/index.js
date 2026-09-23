/**
 * AgenticOw no navegador — metade Node. O `apply` vazio dá ao Loader uma
 * linha do lado do Host; a metade do navegador sai por `exports["./client"]`
 * (o `client.js` gerado por `scripts/gerar-cliente.mjs`).
 * @module @openweights/agenticow-ui
 */

/** Este pacote só contribui apresentação no navegador. */
export function apply() {}
