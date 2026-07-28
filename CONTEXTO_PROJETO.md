# Contexto completo — Rotas Maquininhas

> Documento de handoff pra continuar em outro chat. Cole isso inteiro na primeira mensagem do chat novo.

## O que é o projeto

App (PWA, sem instalação de loja) pra um técnico que instala/mantém maquininhas de cartão em **Ponta Porã/MS** (fronteira com o Paraguai) e distritos **Itamarati** e **Sanga Puitã** (mesmo município). O app:

1. Cadastra OS (ordens de serviço): número, cliente, endereço, contato, banco/máquina, serviço, observações — manual ou tirando foto (OCR lê e preenche sozinho).
2. Monta rotas otimizadas a partir das OS pendentes (ou parada rápida sem precisar virar OS completa).
3. Deixa editar a rota já feita: reordenar, adiar parada, remover, reotimizar, marcar concluída.
4. Funciona como app instalado no celular (PWA), sem mensalidade nenhuma — tudo em serviços gratuitos.

**Local:** `C:\Users\alyss\Desktop\RotasMaquininhas`
**Repo GitHub:** https://github.com/alyssondossantos2000-sudo/rotas-maquininhas
**Link ao vivo:** https://alyssondossantos2000-sudo.github.io/rotas-maquininhas/
**Rodar local:** `python -m http.server 8798 --directory "C:\Users\alyss\Desktop\RotasMaquininhas"` (já configurado em `.claude/launch.json` como `rotas-maquininhas`, cwd é a pasta do Claude Code em "PROJETO TRAMPO")

## Stack (tudo gratuito, de propósito — restrição explícita do usuário)

- **Frontend:** HTML/CSS/JS puro, zero build step, zero framework
- **Backend:** Supabase (projeto `rotas-maquininhas`, id `hmlyszoxxdtweqgrdkgr`, org `efjmeqlpjjgkwosneqsh`) — Postgres + Auth, plano gratuito. Acessível via MCP do Supabase já conectado neste ambiente Claude Code (não precisa de token novo).
- **Mapa:** Leaflet.js + tiles OpenStreetMap
- **Geocodificação:** Nominatim (OSM), restrita à região de Ponta Porã via `viewbox`+`bounded=1` (evita achar endereço igual de outra cidade)
- **Otimização de rota:** OSRM (servidor de demonstração público, endpoint `/trip`)
- **OCR:** Tesseract.js v5, 100% no navegador (celular ou PC), sem chave de API
- **Hospedagem:** GitHub Pages, grátis
- **Conta de teste:** `rotastestecc@exemplo.com` / `Senha12345!` (isolada, não é conta real do usuário)

## Estrutura de arquivos

```
RotasMaquininhas/
├── index.html              # SPA inteiro, todas as telas
├── css/style.css
├── js/
│   ├── config.js            # URL/chave pública do Supabase
│   ├── supabaseClient.js
│   ├── geocode.js            # Nominatim + fallback progressivo + restrição geográfica
│   ├── osrm.js                # otimização de rota via OSRM /trip
│   ├── ocr.js                 # Tesseract.js: pré-processo de imagem, detecção de rotação, extração de campos
│   └── app.js                  # toda a lógica da UI (~1000 linhas)
├── manifest.json, service-worker.js, icons/icon.svg
├── README.md                    # docs voltadas pro usuário final
├── fotos-teste/                  # fotos reais de OS pra testar OCR — NO .gitignore, tem dado de cliente, NUNCA commitar
└── CONTEXTO_PROJETO.md            # este arquivo
```

## Banco de dados (Supabase, RLS por `user_id = auth.uid()`)

**`ordens_servico`**: id, user_id, numero_os (nullable), nome_cliente, endereco, contato, banco, servico, observacoes, status (`pendente|roteirizada|adiada|concluida|cancelada`), lat, lng, geocode_status (`pendente|ok|falhou`), rota_id, ordem_na_rota, origem_cadastro (`manual|foto|csv`), created_at, updated_at

**`rotas`**: id, user_id, nome, data, status (`planejada|em_andamento|concluida`), distancia_km, duracao_min, origem_endereco, origem_lat, origem_lng, geometria (jsonb, geojson da rota), created_at, updated_at

**Trigger `trg_auto_confirm_email`** em `auth.users`: confirma o e-mail automaticamente em todo INSERT — contorna o limite de envio de e-mail do plano gratuito do Supabase E o fato do usuário não ter acesso ao painel do Supabase (o projeto foi criado pela sessão do Claude, login diferente do dele).

## Funcionalidades já prontas (tudo testado e publicado)

- Login/cadastro (Supabase Auth, auto-confirmado)
- Cadastro de OS manual + por foto
- OCR: detecta rotação automática (foto de lado/cabeça pra baixo) via worker OSD leve do Tesseract, converte pra cinza+contraste esticado antes de ler, mostra o texto reconhecido **visível** sobreposto na própria foto (estilo Google Lens) com controle de opacidade, e botões pra selecionar um trecho de texto e jogar num campo específico (útil quando o preenchimento automático erra)
- Extração automática de campos (`parseOsFields` em ocr.js) ajustada com fotos reais de 5 modelos: C6 Bank/FedEx, Cielo, Azulzinha X, Sicredi, C-Trends — cada um com layout bem diferente, nenhum tem rótulo "Banco:" explícito (detecta pela marca no texto)
- Geocodificação restrita a Ponta Porã (+ Itamarati/Sanga Puitã), com fallback progressivo (tenta versão mais simples do endereço se a completa não for achada) e ajuste manual arrastando um pino no mapa
- Montagem de rota: seleciona OS pendentes, ponto de partida opcional (endereço ou GPS), otimização via OSRM
- **Rota salva automaticamente assim que é otimizada** (não precisa de clique extra de "salvar" — bug corrigido, antes perdia a rota se saísse do app antes de clicar salvar)
- Edição de rota: reordenar (▲▼), "deixar pra depois" (manda pro fim, status `adiada`), remover parada, reotimizar, marcar concluída
- Por parada: botões Maps / Waze / WhatsApp (só aparece se tiver contato) e campo de observação editável
- Balão flutuante na tela da rota: mostra a próxima parada pendente, expande ao tocar
- "Parada rápida": cria uma OS simplificada (só cliente + endereço obrigatórios) direto na tela de rota — tanto ao montar rota nova quanto numa rota já salva — com opção de preencher por foto também. Fica escondida atrás de um botão "+ Adicionar parada" por padrão
- Botões de câmera e galeria **separados** (dois `<input type=file>`, um com `capture="environment"` outro sem) — Android às vezes esconde a opção de câmera se só tem um input sem esse atributo

## Bugs encontrados e como foram resolvidos (importante pra não repetir)

1. **Service worker cache-first nos próprios arquivos do app** → editar código e recarregar mostrava versão antiga. Trocado pra network-first.
2. **Cache HTTP do navegador em `<script src="js/app.js">`/`<link href="css/style.css">` (sem query string) é MUITO persistente** — mesmo recarregando a página com `?nocache=N` na URL, o navegador continuava servindo a versão antiga do script/CSS porque a URL DELES não mudou. Resolvido colocando `?v=N` direto nas tags `<script>`/`<link>` do index.html **e** em cada `import ... from "./arquivo.js?v=N"` dentro do app.js (import estático aceita query string). **Toda vez que editar `js/*.js` ou `css/style.css`, bump esse número em TODOS os lugares** (index.html tem 2 ocorrências do `?v=`, app.js tem 4 imports, supabaseClient.js tem 1). Está em `v=6` atualmente. Sem isso, dá pra passar horas achando que uma mudança não funcionou quando na real é só cache.
3. **OSRM `/trip` retorna erro "NotImplemented"** se `roundtrip=false` com `source=any` E `destination=any` juntos. Corrigido: com ponto de partida definido usa `source=first&destination=any&roundtrip=false`; sem ponto de partida usa `roundtrip=true` (circuito) e descarta a última perna (volta ao início) do cálculo de distância/duração.
4. **Fotos de câmera reais (vários MB, 3000-4000px) travavam/reiniciavam o app** ao processar cru no Tesseract.js. Corrigido reduzindo pra no máximo ~2000px antes do OCR.
5. **Seleção de texto sumia no celular** ao tocar num botão fora do texto selecionado (o navegador limpa a seleção antes do evento de clique rodar). Corrigido capturando o texto selecionado no `pointerdown` (com `preventDefault`) em vez de no `click`.
6. **Numeração dos marcadores no mapa começava em "0"** quando tinha ponto de partida. Corrigido (bug bobo de índice).

## Coisa que NÃO ficou resolvida / precisa de teste em aparelho real

Durante a última sessão, ao testar via ferramenta de automação de navegador deste ambiente (não é o navegador real do usuário), um botão de esconder/mostrar e um input de arquivo pareciam não disparar o listener do app mesmo com clique/evento comprovadamente chegando no elemento (um listener de teste novo, adicionado na hora, funcionava normalmente; o do app não). Reli o código várias vezes e ele parece correto, seguindo o mesmo padrão usado em várias outras partes do arquivo que funcionam. Nunca cheguei a uma causa raiz clara, e a ferramenta de teste desse ambiente mostrou outros comportamentos estranhos na mesma sessão (não captura exceções não tratadas, `screenshot` falhando com "Browser pane not displayed", mensagens de console aparentemente "congeladas"). **Recomendação: se algo parecer não funcionar, testar direto no celular real antes de assumir que é bug de verdade — pode ser só a ferramenta de teste.**

## Ideias discutidas, ainda NÃO implementadas (assunto do próximo chat)

O usuário quer melhorar a **velocidade e qualidade do OCR**, e levantou duas possibilidades:

1. **Processar o OCR em outro lugar** que não o celular — no PC dele, ou algum servidor — porque "tem que ser rápido" e ele "tem tempo e tudo pra fazer isso".
2. **Fazer um APK Android** pra ter uma experiência mais fluida que o PWA no navegador (o app já é 100% HTML/CSS/JS, então dá pra embrulhar com **Capacitor** ou similar reaproveitando tudo, e ganhar acesso nativo à câmera — o que resolveria de forma mais robusta a questão do Android que tentamos consertar via HTML puro).

Pontos a decidir no próximo chat:
- Onde processar OCR: continuar 100% no aparelho (Tesseract.js), mover pra um servidor que ele controla (evita custo mensal, mas precisa manter uma máquina ligada/acessível), ou usar uma API paga de OCR melhor (contradiz a regra de "sem mensalidade" que guiou o projeto todo até aqui — vale confirmar se essa regra ainda vale considerando que ele "tem tempo e recursos" agora)
- Se compensa migrar pra Capacitor/APK agora ou só depois de validar o fluxo web mais
- Confirmar se a correção de câmera/galeria feita nessa sessão resolveu de verdade no Android real

## Como o usuário gosta de trabalhar

- Português informal, direto, não gosta de enrolação
- Extremamente sensível a custo — sempre serviços gratuitos, evitar mensalidade
- Testa direto no celular real (Android e iOS) — é o teste que vale de verdade
- Prefere ação rápida a explicação longa
- Já avisou explicitamente quando achou que uma conversa estava "comendo muito token" — vale ser econômico e objetivo
