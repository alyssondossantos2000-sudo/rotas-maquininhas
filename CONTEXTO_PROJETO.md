# Contexto completo — Rotas Maquininhas

> Documento de handoff pra continuar em outro chat. Cole isso inteiro na primeira mensagem do chat novo.

## O que é o projeto

App (PWA + APK Android via Capacitor) pra um técnico que instala/mantém maquininhas de cartão em **Ponta Porã/MS** (fronteira com o Paraguai) e distritos **Itamarati** e **Sanga Puitã** (mesmo município) — mas pode atender fora dessa região também (ver "Perfil" abaixo). O app:

1. Cadastra OS (ordens de serviço): endereço é o único campo obrigatório; número, cliente, contato, banco/máquina, serviço, observações são opcionais — manual ou tirando foto (OCR lê e preenche sozinho).
2. Monta rotas otimizadas a partir das OS pendentes (ou parada rápida sem precisar virar OS completa).
3. Deixa editar a rota já feita: reordenar, adiar parada, remover, reotimizar, marcar concluída.
4. Funciona como site (GitHub Pages) e como **APK Android instalado** (mesmo código, empacotado via Capacitor) — sem mensalidade nenhuma, tudo em serviços gratuitos ou de plano grátis generoso.

**Local:** `C:\Users\alyss\Desktop\RotasMaquininhas`
**Repo GitHub:** https://github.com/alyssondossantos2000-sudo/rotas-maquininhas
**Link ao vivo (site):** https://alyssondossantos2000-sudo.github.io/rotas-maquininhas/
**Rodar local (site):** `python -m http.server 8798 --directory "C:\Users\alyss\Desktop\RotasMaquininhas"` (configurado em `.claude/launch.json` como `rotas-maquininhas`)
**Versão atual do cache-busting `?v=`:** `28` (ver bug #2 abaixo — crítico bumpar em todo edit)

## Conta real do usuário vs conta de teste

- **Conta de verdade, com todos os dados de produção** (28+ OS reais): `alyssondossantos2000@gmail.com`, no Supabase Auth. É essa que o técnico usa no celular.
- **Conta de teste isolada** (não é do usuário, criada por uma sessão anterior do Claude): `rotastestecc@exemplo.com` / `Senha12345!` — só 5 OS de teste, útil pra testar sem mexer em dado real.
- O projeto Supabase (`hmlyszoxxdtweqgrdkgr`) foi criado por uma sessão do Claude, **não é a conta do usuário** — ele não acessa o painel. Isso já causou um problema real: o projeto **pausou sozinho por inatividade** (plano grátis) numa sessão e precisou ser reativado via MCP antes de qualquer teste funcionar. **Ainda não migrado** pra conta própria do usuário — ficou de fazer depois, ele só perguntou e decidimos adiar.

## Stack

- **Frontend:** HTML/CSS/JS puro, zero build step pro site; zero framework
- **App nativo:** Capacitor (`android/`), gera APK via Gradle. Ver seção própria abaixo.
- **Backend:** Supabase (Postgres + Auth), plano gratuito. MCP do Supabase já conectado neste ambiente.
- **Mapa:** Leaflet.js + tiles OpenStreetMap
- **Geocodificação:** **LocationIQ** (trocado do Nominatim público nessa sessão — ver bug grave abaixo). Chave em `js/config.js` (`LOCATIONIQ_KEY`, plano grátis, ~2 req/seg, 5k/dia). Busca em **duas etapas** (raio mínimo local, só expande pro raio máximo configurado se não achar nada perto — ver "Perfil e raio de busca" abaixo).
- **Otimização de rota:** OSRM (servidor de demonstração público, endpoint `/trip`)
- **OCR:**
  - **No site (navegador comum):** Tesseract.js v5, 100% no navegador.
  - **No APK (nativo):** Google ML Kit (`@capacitor-mlkit/text-recognition`) — offline, embutido no APK, melhor que Tesseract em foto de câmera real.
  - **Servidor OCR local do PC (opcional, só dentro do APK):** PaddleOCR na GPU do PC do usuário, mesma rede Wi-Fi — tentado primeiro se configurado, cai pro ML Kit sozinho se o PC não responder em ~2.5s. Documentado em `CONTEXTO_OCR_LOCAL.md`. Código em `js/ocr/localServerProvider.js`.
  - Pipeline modular completo em `js/image/` (rotação automática, correção de perspectiva — **detecção de documento está DESLIGADA desde 29/07**, cortava conteúdo real de fotos, ver `documentDetector.js` `ATIVO=false`) → `js/ocr/` (providers + normalização) → `js/layout/` (reconstrução de blocos) → `js/interpret/` (extração de campos por tipo de formulário).
- **Bolha flutuante nativa:** `BubbleOverlayPlugin`/`BubbleOverlayService` (Android) — mostra a próxima parada da rota por cima de qualquer app (tipo chat-head), com botões de ação. Só funciona no APK.
- **Hospedagem site:** GitHub Pages, grátis.
- **Contas de teste:** ver seção acima.

## Gerar e instalar o APK

```bash
npm run build              # copia js/index.html/css pra www/ + empacota native/entry.js
npx cap sync android       # copia www/ + plugins pro projeto Android
cd android
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew assembleDebug
# APK gerado em android/app/build/outputs/apk/debug/app-debug.apk
```

**Sobre o JAVA_HOME:** a máquina só tem JDK 17 instalado globalmente, mas o Gradle desse projeto pede JDK 21 — o Android Studio já vem com um JDK 21 embutido (`jbr`), usar esse via `JAVA_HOME` inline resolve sem precisar instalar nada.

**Instalar direto no celular via cabo USB** (depuração USB autorizada no aparelho):
```bash
"/c/Users/alyss/AppData/Local/Android/Sdk/platform-tools/adb.exe" install -r "caminho/do/app-debug.apk"
# se o app já tava aberto, force-stop + relaunch garante que pega o código novo:
adb shell am force-stop com.rotasmaquininhas.app
adb shell monkey -p com.rotasmaquininhas.app -c android.intent.category.LAUNCHER 1
```
`adb shell input tap/text` **não funciona** nesse aparelho (Xiaomi/MIUI bloqueia injeção de evento, `SecurityException: INJECT_EVENTS`) — só dá pra tirar screenshot (`adb exec-out screencap -p`) e inspecionar localStorage via `run-as` + `grep` no leveldb, não automatizar toque.

## Estrutura de arquivos (resumo — bem mais módulos que antes)

```
RotasMaquininhas/
├── index.html                    # SPA inteiro, todas as telas (agora com aba "Perfil")
├── css/style.css
├── js/
│   ├── config.js                  # Supabase + LOCATIONIQ_KEY
│   ├── supabaseClient.js
│   ├── geocode.js                  # LocationIQ, busca em 2 etapas, Perfil (raio min/max), autocomplete
│   ├── osrm.js
│   ├── ui/
│   │   ├── addressAutocomplete.js   # componente reutilizável de sugestão de endereço ao vivo
│   │   ├── capture.js, overlay.js, zoom.js
│   ├── ocr/
│   │   ├── provider.js              # Strategy: Tesseract (web) / ML Kit+servidor local (nativo)
│   │   ├── mlkitProvider.js, localServerProvider.js, wordMapper.js
│   ├── image/                      # rotação, perspectiva, detecção de documento (desligada)
│   ├── layout/, interpret/         # reconstrução de layout + extração de campos por banco
│   └── app.js                       # lógica da UI (~1200+ linhas)
├── native/entry.js                  # entrypoint que passa por esbuild (único arquivo com bundler)
├── android/                          # projeto Capacitor/Gradle completo
├── www/                               # gerado por `npm run build`, NÃO editar direto (.gitignore)
├── scripts/build-www.mjs
├── manifest.json, service-worker.js (network-first), icons/icon.svg
├── fotos-teste/                        # fotos reais de OS — NO .gitignore, NUNCA commitar
├── CONTEXTO_PROJETO.md                  # este arquivo
├── CONTEXTO_OCR_LOCAL.md                 # servidor OCR local do PC (PaddleOCR)
└── CONTEXTO_TREINAMENTO_OCR.md            # sobre "treinar" extração de campo por layout
```

## Banco de dados (Supabase, RLS por `user_id = auth.uid()`)

**`ordens_servico`**: id, user_id, numero_os (nullable), **nome_cliente (nullable, mudou nessa sessão)**, endereco (obrigatório, único campo realmente obrigatório), contato, banco, servico, observacoes, status (`pendente|roteirizada|adiada|concluida|cancelada`), lat, lng, **geocode_status (`pendente|ok|aproximado|falhou` — `aproximado` é novo)**, rota_id, ordem_na_rota, origem_cadastro (`manual|foto|csv`), created_at, updated_at

**`rotas`**: id, user_id, nome, data, status, distancia_km, duracao_min, origem_endereco, origem_lat, origem_lng, geometria (jsonb), created_at, updated_at

**Trigger `trg_auto_confirm_email`** em `auth.users`: confirma e-mail automaticamente em todo INSERT.

## Perfil e raio de busca de endereço (feature nova dessa sessão)

Aba "👤 Perfil" no menu de baixo — usuário configura:
- **Cidade/região base** (com autocomplete, sem restrição geográfica — pode escolher qualquer lugar do Brasil)
- **Raio mínimo (km)** — busca local, tentada SEMPRE primeiro
- **Raio máximo (km)** — "arredores", só é tentado como 2ª etapa se a busca local (raio mínimo) não achar absolutamente nada

Padrão sem configurar nada: centro em Ponta Porã, raio mínimo e máximo ambos 70km (cobre o município + Itamarati + Sanga Puitã). Salvo em `localStorage` (`rm_perfil_busca`), por aparelho — **não sincroniza entre celular e navegador de teste**, cada um tem seu próprio.

**Por que duas etapas e não só ordenar por distância:** testado com raio máximo de 250km — mesmo ordenando o resultado por distância, a API já corta o número de resultados retornados ANTES de mandar a resposta, priorizando "importância" geral (rua de cidade grande "pesa" mais que rua pequena de Ponta Porã) — então a rua certa podia nem vir na resposta. A solução foi separar em duas chamadas: raio pequeno primeiro (onde a rua local não compete com nada de fora, sempre ganha), só expande se não achar nada.

## Autocomplete de endereço (feature nova dessa sessão)

Campo "Endereço completo" (tela Nova OS) tem sugestão ao vivo tipo Google Maps:
- Digita → debounce 300ms → busca LocationIQ → mostra lista (rua + bairro como contexto, distância se >15km)
- Escolhe uma opção → só a **rua** vai pro campo (não o bairro) — assim completar com o número da casa é só continuar digitando no FINAL ("Rua Felipe de Brum" + " 310"), sem precisar inserir no meio do texto (bug real corrigido: antes vinha "Rua X, Bairro" junto, e o número tinha que entrar entre os dois)
- Completar o texto depois de escolher **não invalida** a coordenada escolhida, contanto que o texto ainda comece com o que foi escolhido (prefixo) — só invalida se apagar/alterar a parte escolhida
- **Mini-mapa da OS abre sozinho** ao escolher uma sugestão, mostrando o pino na hora (não precisa mais clicar em botão separado)
- Botão de lupa (🔍) colado no campo — busca/mostra no mapa manualmente a qualquer momento
- Componente reutilizável (`js/ui/addressAutocomplete.js`) também usado no campo "Cidade base" da tela Perfil (com busca nacional, sem restrição de área)

## Funcionalidades já prontas (tudo testado e publicado no site + instalado no celular)

- Login/cadastro (Supabase Auth, auto-confirmado)
- Cadastro de OS manual + por foto — **só endereço obrigatório** agora
- OCR completo (ver seção Stack acima) com overlay visível na foto, seleção de trecho pra atribuir a um campo, seletor de tipo de formulário/banco
- Geocodificação com autocomplete + raio configurável (Perfil) — ver seções acima
- Aviso "⚠️ Localização aproximada" em 3 lugares (card da OS, balão de próxima parada, lista da rota) quando `geocode_status = 'aproximado'` — visível ANTES de navegar até lá
- Montagem de rota: seleciona OS pendentes, ponto de partida opcional, otimização via OSRM, salva automaticamente
- Edição de rota: reordenar, adiar, remover, reotimizar, marcar concluída
- Por parada: botões Maps / Waze / WhatsApp + observação editável
- Balão flutuante (web) + **bolha flutuante nativa por cima de outros apps** (Android, via BubbleOverlay)
- "Parada rápida": OS simplificada (só endereço obrigatório agora) direto na tela de rota
- Servidor OCR local do PC (PaddleOCR) como opção mais forte, com fallback automático

## Bugs graves encontrados e corrigidos nessa sessão (14-15/08)

O usuário relatou "o mapa mandou eu pra um posto de polícia em vez da distribuidora" — investigação achou VÁRIOS bugs reais, não só um:

1. **Geocodificação (Nominatim) abortava a cadeia de tentativas inteira se UMA tentativa falhasse por erro de rede** — corrigido: cada tentativa isolada num try/catch, as outras seguem tentando.
2. **Resultado de nível "CEP" (não rua/casa) era aceito como confiável** sem aviso — achado 7 OS de clientes diferentes na MESMA coordenada (centro genérico do CEP), uma delas a ~4km do endereço real. Corrigido rejeitando `postcode`/`postal_code`/`suburb`/`neighbourhood` como resultado "específico".
3. **Trocado o provedor de geocodificação de Nominatim público (limite de 1 req/seg, e chegou a BLOQUEAR a sessão por uso intenso durante teste) pra LocationIQ** (mesmos dados OSM, plano grátis 2 req/seg, chave do próprio usuário em `config.js`).
4. **Busca com raio grande priorizava rua de cidade vizinha em vez da rua local** — corrigido com busca em duas etapas (ver seção "Perfil" acima).
5. Registro real de produção (`REAL SUL NUTRICAO ANIMAL LTDA`) e outras 9 OS tiveram a coordenada corrigida direto no banco via SQL.
6. **`OpenCV.js` (~8MB) sendo baixado à toa** toda vez que a aba "Por foto" abria, pra uma função (detecção de documento) desligada desde 29/07 — removido o carregamento morto.
7. **`nome_cliente` era NOT NULL no banco** mas a UI já tratava como opcional em alguns lugares — migração pra permitir null, e `numero_os`/`nome_cliente` deixaram de ser obrigatórios no formulário (só endereço é).

## Bugs de sessões anteriores (histórico, ainda válido)

1. **Service worker cache-first** → trocado pra network-first.
2. **Cache HTTP do navegador em `<script src>`/`<link href>` sem query string é MUITO persistente** — resolvido com `?v=N` em toda tag `<script>`/`<link>` e todo `import ... from "./arquivo.js?v=N"`. **Bumpar esse número em TODOS os lugares a cada edit** de `js/*.js` ou `css/style.css` — está em `v=28` agora. Sem isso, dá pra passar horas achando que uma mudança não funcionou quando é só cache (aconteceu de novo nessa sessão, inclusive).
3. **OSRM `/trip` erro "NotImplemented"** com `source=any`+`destination=any` juntos — corrigido usando `source=first` quando tem origem definida.
4. **Fotos de câmera grandes travavam o OCR** — reduzido pra no máximo ~4500px (na sessão atual; era menor antes, subiu porque o usuário prefere qualidade mesmo com OCR mais lento).
5. **Seleção de texto sumia no celular ao tocar em botão** — capturado no `pointerdown` em vez de `click`.
6. **Tesseract confundido com ML Kit no `wordMapper.js`** (ambos têm propriedade `blocks`, formatos diferentes) — zerava todos os campos silenciosamente. Corrigido checando o formato mais específico primeiro.

## Assunto do PRÓXIMO chat (pedido explícito do usuário)

**Melhorar o sistema de tirar foto da OS pra já vir todos os dados preenchidos** — hoje o OCR já lê e tenta extrair campos automaticamente (`js/interpret/documentInterpreter.js`, ajustado pra ~5-6 modelos de formulário conhecidos: C6 Bank, Cielo, Azulzinha, Sicredi, C-Trends...), mas nem sempre pega tudo certo. Vale:
- Testar com mais fotos reais de formulários que ainda erram campo
- Ver se a extração por tipo de banco/formulário precisa de mais "moldes" (ver `CONTEXTO_TREINAMENTO_OCR.md`)
- Considerar se a detecção de documento (hoje desligada) vale a pena tentar reativar com uma abordagem diferente, já que cortava conteúdo real antes

**"Questão do número"** — o usuário mencionou querer melhorar isso também, mas **acha que é mais um problema físico/de processo** (como o número da OS é escrito/organizado no papel do formulário real) do que algo que dá pra resolver só no código — mencionar no próximo chat pra ele explicar melhor o que quer dizer, não presumir que é uma tarefa de software.

**Migrar o Supabase pra conta própria do usuário** — discutido, adiado, ainda pendente (ver seção "Conta real vs teste" acima).

## Como o usuário gosta de trabalhar

- Português informal, direto, não gosta de enrolação
- Extremamente sensível a custo — sempre serviços gratuitos ou free-tier generoso, evitar mensalidade
- Testa direto no celular real — é o teste que vale de verdade (esse ambiente já teve resultado diferente do celular real mais de uma vez)
- Prefere ação rápida a explicação longa — pede pra "fazer" em vez de explicar opções longamente
- Dá feedback específico e técnico quando algo não funciona (ex: descreveu exatamente onde o número da casa devia entrar no texto) — vale prestar atenção aos detalhes que ele dá, geralmente apontam a causa raiz certa
