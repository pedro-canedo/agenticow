# AgenticOw — o fork

AgenticOw é o harness agêntico do [OpenWeights](https://github.com/pedro-canedo/openweights):
um fork do [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) mantido no
modelo Cursor/VS Code — núcleo do upstream, personalização nossa por cima, sincronização
periódica. Ele roda como um Host Node supervisionado pelo app e aparece dentro da janela
principal do OpenWeights.

## Identidade e licença

- **Base:** tag `dsh-v0.1.5-rc.3` (`a4c74a91`, 2026-09-22). O upstream só publica tags
  alpha e rc; sincronizamos apenas por rc.
- **Licença:** o código do upstream é MIT (`LICENSE`, Copyright (c) 2026 DeepSeek) e continua
  sob ela. `native/system` é **BSD-3-Clause**. O runtime distribuído leva os avisos de
  licença da closure inteira de dependências.
- **Marca:** "DeepSeek Harness" é marca registrada da DeepSeek (`BRAND_GUIDELINES.md`). O
  produto se chama AgenticOw; a relação aparece só como "baseado no DeepSeek Harness (MIT)".
  Nenhum material de marca oficial (a baleia) é usado de forma que sugira endosso.

## Regras do fork

1. **Diff mínimo no núcleo.** Personalização entra como pacote novo em
   `packages/openweights/*` (`@openweights/*`, `private: true`), app novo em
   `apps/openweights-host` e patch no `cordis.patch.yml` do próprio profile, por cima do
   `web-app`.
2. **Edição em arquivo do upstream só onde não houver seam** (`docs/capability-seams.md`),
   e cada uma entra na tabela abaixo.
3. **Nomes internos ficam `@deepseek-ai/*`.** Nada é publicado no npm; renomear transformaria
   cada sincronização em conflito. Muda só o que a pessoa vê.
4. **Sincronização por tag rc**, com merge (sem rebase) num PR `sync/upstream-<tag>`. A
   `pnpm-lock.yaml` é **regenerada**, nunca mesclada à mão. Uma rc pode ser pulada.

### Edições em arquivos do upstream

| Arquivo | Motivo | Como reaplicar |
|---|---|---|
| — | nenhuma até aqui | — |

## Fase 0 — spike de viabilidade (2026-09-23)

Medido no Linux (Bluefin/Fedora 44, Ryzen 7 5700X3D, 16 threads), com **Node v22.20.0**
(o mesmo `PINNED_NODE` do OpenWeights, ABI 127) e **pnpm 11.7.0** via corepack.

| # | Verificação | Resultado |
|---|---|---|
| 0.1 | Base `dsh-v0.1.5-rc.3` | ✅ `main` = `a4c74a91`, 16.375 commits de história |
| 0.2 | Install + build | ✅ Linux: `pnpm install --frozen-lockfile` **14 s**; `pnpm run build` **115 s**. ⏳ Windows (CI) |
| 0.3 | Host sem `--expose-internals` | ✅ 3 boots limpos na árvore de produção. O loader do Cordis cai no `node-addon-require-builtin` (Node-API v9, pré-compilado por plataforma) |
| 0.4 | Profile próprio `patchReload: "startup"` sobre o `web-app` | ✅ workspace e árvore de produção. O `web` (`live`) também sobe — ver "crash do HMR" abaixo |
| 0.5 | Child webview × iframe, com a autenticação real | ✅ Linux (Tauri 2.11.5, WebKitGTK 2.52.6, X11): child faz 303 → cookie → 200 → WebSocket, zero erros. O iframe **também** funciona no WebKitGTK. ⏳ Windows (WebView2) e macOS (WKWebView) na CI |
| 0.6 | Cliente web no WebKit | ✅ WebKit do Playwright 1.61.1 e WebKitGTK 2.52.6 real: zero erros de console, WebSocket ativo. ⏳ WebKitGTK do Ubuntu 22.04 (base do AppImage) |
| 0.7 | Tamanho / arquivos / caminho | ✅ árvore de produção sem filtro: **276 MB, 23.987 arquivos**, maior caminho relativo 172 caracteres. Filtro de `.map`/`.d.ts`/`.md`/fontes `.ts` tira ~126 MB e ~14 mil arquivos; prebuilds do node-pty de outras plataformas, ~20 MB. Estimativa: **~130 MB, ~10 mil arquivos**. ⏳ extração no Windows com o Defender |
| 0.8 | `pnpm deploy --prod` hoisted | ✅ com ressalvas — ver "empacotamento" abaixo |
| 0.9 | Nativos | ✅ Linux: todo binário da closure é **Node-API** (inclusive o node-pty, via `node-addon-api`), então nenhum fica preso ao ABI do Node. `fs-ext` não existe nesta base. ⏳ demais alvos |
| 0.10 | Saída de rede | ✅ parcial: boot + 30 s em repouso = **nenhuma conexão de saída**. ⏳ numa sessão com modelo |
| 0.11 | Sessões gravadas pela 0.1.1-rc.2 | ✅ pelo código: a 0.1.1 gravava o **formato 0**; esta base grava o 3 e traz a cadeia `v0→v1→v2→v3`, que está na árvore de produção. ⏳ prova com um home real da 0.1.1 |
| 0.12 | Ensaio de sync | ⏳ depois do esqueleto da Fase 1 (hoje `main` é ancestral do master: o merge seria fast-forward) |

### Achados que mudam o desenho

**Empacotamento — o host tem de declarar os peers.** Os seams do upstream são
`peerDependencies`, e quem compõe a aplicação precisa fornecê-los. Um `pnpm deploy` do
`@deepseek-ai/dsh` sai **quebrado**: faltam 21 peers obrigatórios, começando pelo
`@deepseek-ai/cordis-plugin-group` (que o próprio `dsh-app-boot` importa e o CLI não declara).
Declarando-os no host, a closure fecha com **26 dependências** diretas em três rodadas:

```
@deepseek-ai/dsh  cordis-plugin-group  schemastery
dsh-anonymous-user-id  dsh-attachment  dsh-authorization  dsh-bash-local  dsh-code-runtime
dsh-compaction  dsh-fs  dsh-hook-protocol  dsh-jobs  dsh-output-retention  dsh-sandbox
dsh-sdk-protocol  dsh-session-persistence  dsh-session-query  dsh-session-telemetry
dsh-session-title-llm  dsh-settings  dsh-shell  dsh-spill  dsh-subagent-in-process-driver
dsh-util-time  dsh-util-workspace-path  dsh-workflow
```

Consequência para a Fase 1/3: o `package.json` de `apps/openweights-host` declara a closure
de peers explicitamente, e um **verificador de dependências** (resolução por diretório, como
o Node faz — `require.resolve` dá falso positivo em pacote ESM com `exports` restrito) vira
portão da CI.

**Empacotamento — os overrides `link:vendor/*` não sobrevivem ao deploy.** O
`pnpm-workspace.yaml` força `@deepseek-ai/cosmokit` e `@deepseek-ai/schemastery` para
`link:vendor/*`. No deploy, o `schemastery` vira symlink para fora da árvore e o `cosmokit`
**some** (o `cordis` quebra no import). O script de preparo do runtime tem de materializar
os `vendor/*` como pacotes reais e falhar se sobrar qualquer symlink externo.

**O crash do HMR da 0.1.5 era provavelmente a forma da árvore.** Numa árvore com uma cópia
de cada pacote, o `web` (`patchReload: "live"`) sobe normalmente. O crash visto em
2026-09-22 foi na árvore que o **npm** monta; como o npm 7+ instala peers sozinho, a hipótese
forte é uma cópia duplicada do `cordis` (`ctx.get("hmr")` indefinido logo depois de criar o
plugin). Não confirmado no npm — irrelevante para nós, já que a árvore é nossa.

**UI: child webview, não iframe.** A 0.1.5+ troca o `?token=` (303) por um cookie
`HttpOnly; SameSite=Strict` (`packages/client/connection/src/browser-auth.ts`), exigido em
toda API e no WebSocket. A child webview do Tauri navega em primeira parte e funciona. O
iframe funcionou no WebKitGTK (a página principal do Tauri no Linux é `tauri://localhost`),
mas no WebView2 a origem principal é `http://tauri.localhost` e a regra `SameSite` do
Chromium bloqueia — a decisão pela child vale para os três sistemas, pendente de prova em
Windows e macOS.

**Autenticação medida.** `/` sem cookie → 401; `/?token=…` → 303 + `dsh-auth-<hash>`;
`/` com cookie → 200; API sem cookie → 401. `SIGTERM` encerra com código 0 em ~0,7 s; a URL
sai em ~3,6 s na árvore de produção. A única linha no stdout é `dsh web: <url>` — o canal de
controle da Fase 1 substitui essa leitura.

**node-pty precisa do `spawn-helper`.** O patch do upstream no node-pty procura o helper em
`DSH_NODE_PTY_SPAWN_HELPER` ou ao lado do `process.execPath`; o runtime tem de levá-lo com
permissão de execução.

**Links do profile são autorregenerados.** O Host projeta a closure em
`$DSH_HOME/profiles/node_modules` (symlinks absolutos; junction no Windows, sem privilégio)
para plugins externos enxergarem as mesmas instâncias. É refeito a cada boot sob lock, então
a troca de versão do runtime não quebra o home. Sem plugins de usuário na v1, nem entra em jogo.

**Superfícies de marca a trocar na Fase 2** (vistas na UI real): título "DSH Local Build",
logo da baleia, diálogo "Internal Testing Notice" (cita DeepSeek Harness),
`.anonymous-user-id` e `dsh-session-telemetry-otel` (27,5 MB de OpenTelemetry) — candidatos
do teste de saída de rede.

### Como reproduzir

```sh
# Node do app e pnpm pinado
export PATH=<node-v22.20.0>/bin:$PATH COREPACK_HOME=<cache>/corepack
corepack enable --install-directory <cache>/bin pnpm
pnpm install --frozen-lockfile && pnpm run build

# árvore de produção (o host de spike declarava as 26 dependências acima)
pnpm --filter <host> deploy --prod --legacy --config.node-linker=hoisted <destino>

# boot de um profile startup
DSH_HOME=<home> node <cli>/lib/bin.js --profile openweights --from-default-profile web --help
#   (trocar dsh.profile.patchReload para "startup" em <home>/profiles/openweights/package.json)
DSH_HOME=<home> node <cli>/lib/bin.js --profile openweights --port 0 --no-open
```
