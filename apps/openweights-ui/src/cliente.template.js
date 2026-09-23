// GERADO por scripts/gerar-cliente.mjs a partir de src/cliente.template.js,
// src/pt-BR/*.json e assets/mark.svg — não edite à mão; rode `pnpm run gerar`.
window.__ModuleLoader__.load({
	id: "@openweights/agenticow-ui",
	factory: (require) => {
		const { jsx } = require("react/jsx-runtime");

		/** Dicionários pt-BR por namespace da UI do upstream (fallback: en). */
		const PT_BR = __DICIONARIOS__;

		/** Símbolo do OpenWeights, a marca do AgenticOw. */
		const MARCA = __MARCA__;

		const NOME = "AgenticOw";

		/**
		 * @param {{ size?: number }} props
		 */
		function Marca({ size }) {
			const lado = typeof size === "number" ? size : 24;
			return jsx("img", { src: MARCA, width: lado, height: lado, alt: "", draggable: false, style: { display: "block" } });
		}

		function Nome() {
			return jsx("span", { children: NOME, style: { fontWeight: 600, letterSpacing: "-0.01em" } });
		}

		function marcarDocumento() {
			if (typeof document === "undefined") return;
			// A UI do upstream reescreve o título a partir de `brand.localBuild`
			// quando o idioma muda; em inglês (dicionário que não dá para
			// sobrescrever) ele voltaria a "DSH Local Build".
			const titulo = () => { if (document.title !== NOME) document.title = NOME; };
			titulo();
			new MutationObserver(titulo).observe(document.head, { subtree: true, childList: true, characterData: true });
			let icone = document.querySelector('link[rel~="icon"]');
			if (icone === null) {
				icone = document.createElement("link");
				icone.rel = "icon";
				document.head.appendChild(icone);
			}
			icone.type = "image/svg+xml";
			icone.href = MARCA;
		}

		const inject = ["locale", "slots"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.addLanguage({ id: "pt-BR", label: "Português (Brasil)", fallback: "en" }), "agenticow-ui: pt-BR");
			for (const [ns, dicionario] of Object.entries(PT_BR)) {
				ctx.effect(() => ctx.locale.register(ns, "pt-BR", dicionario), `agenticow-ui: pt-BR ${ns}`);
			}
			ctx.slots.inject("sidebar.brand.mark", () => ctx.slots.inject("sidebar.brand.name", function* () {
				yield ctx.slots.register({ name: "sidebar.brand.mark" }, Marca);
				yield ctx.slots.register({ name: "sidebar.brand.name" }, Nome);
			}));
			ctx.slots.inject("conversation.hero.brand.mark", () => ctx.slots.register({ name: "conversation.hero.brand.mark" }, Marca));
			marcarDocumento();
		}

		return { apply, inject };
	}
});
