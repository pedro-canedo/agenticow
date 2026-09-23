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

		/**
		 * Os modelos do AgenticOw vêm do OpenWeights: o catálogo do app substitui a
		 * seção `llm-pi-ai` inteira a cada atualização. A página de Modelos diz
		 * isso antes que alguém configure algo aqui e veja sumir.
		 */
		const NS_OW = "openweights";
		const TEXTOS = {
			en: {
				"models.title": "Models come from OpenWeights",
				"models.body": "AgenticOw uses the sources you set up in OpenWeights: the Local Server, OpenRouter and 9router. To add a model, change a key or pick favourites, use the Sources and Local Server screens in the app; changes made on this page are replaced the next time the app updates the list.",
			},
			"pt-BR": {
				"models.title": "Os modelos vêm do OpenWeights",
				"models.body": "O AgenticOw usa as fontes que você configura no OpenWeights: o Servidor Local, o OpenRouter e o 9router. Para acrescentar um modelo, trocar uma chave ou escolher favoritos, use as telas Fontes e Servidor Local do app; o que for alterado nesta página é substituído na próxima atualização da lista.",
			},
		};

		/**
		 * @param {{ t: (chave: string) => string }} props
		 */
		function OrigemDosModelos({ t }) {
			return jsx("div", {
				role: "note",
				style: {
					margin: "16px 0 0",
					padding: "12px 16px",
					borderRadius: 12,
					border: "1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.3))",
					lineHeight: 1.5,
				},
				children: [
					jsx("div", { children: t("models.title"), style: { fontWeight: 600, color: "var(--dsw-alias-label-primary, inherit)" } }),
					jsx("div", { children: t("models.body"), style: { marginTop: 4, fontSize: 13, color: "var(--dsw-alias-label-secondary, inherit)" } }),
				],
			});
		}

		/**
		 * A página de Modelos do upstream oferece acrescentar provedores (o catálogo
		 * embutido do pi-ai e um personalizado). No AgenticOw isso só engana: o
		 * catálogo do app substitui a seção inteira, e a chave digitada iria para um
		 * arquivo. Não há opção para desligar, então os dois botões somem daqui —
		 * achados pelo texto do próprio upstream, no idioma ativo; o e2e da UI cobra.
		 * @param {any} ctx
		 */
		function semAdicionarProvedores(ctx) {
			if (typeof document === "undefined") return;
			const t = ctx.locale.bind("settings.models");
			let agendado = false;
			const varrer = () => {
				agendado = false;
				const dialogo = document.querySelector('[role="dialog"]');
				if (dialogo === null) return;
				const alvos = new Set([t("add"), t("customAdd")]);
				for (const botao of dialogo.querySelectorAll("button")) {
					if (botao.style.display !== "none" && alvos.has((botao.textContent ?? "").trim())) botao.style.display = "none";
				}
			};
			new MutationObserver(() => {
				if (agendado) return;
				agendado = true;
				requestAnimationFrame(varrer);
			}).observe(document.body, { childList: true, subtree: true, characterData: true });
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
			for (const [idioma, textos] of Object.entries(TEXTOS)) {
				ctx.effect(() => ctx.locale.register(NS_OW, idioma, textos), `agenticow-ui: ${NS_OW} ${idioma}`);
			}
			ctx.slots.inject("settings.models.footer", () => ctx.slots.register({
				name: "settings.models.footer",
				id: "openweights-origem",
				order: -100,
				locale: NS_OW,
			}, OrigemDosModelos));
			marcarDocumento();
			semAdicionarProvedores(ctx);
		}

		return { apply, inject };
	}
});
