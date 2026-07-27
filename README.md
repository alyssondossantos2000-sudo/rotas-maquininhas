# Rotas Maquininhas

App para cadastrar OS (ordens de serviço) de instalação/manutenção de maquininhas e montar rotas de entrega otimizadas. Funciona no celular como um app (PWA), sem precisar pagar mensalidade de servidor.

## O que já faz

- Login (cada usuário só vê as próprias OS/rotas)
- Cadastro de OS: número, cliente, endereço, contato (telefone/WhatsApp), banco, serviço, observações
- Cadastro por foto: tira uma foto da OS e o app tenta ler e preencher os campos sozinho — inclusive o contato — reconhecendo os padrões de vários modelos reais (C6 Bank/FedEx, Cielo, Azulzinha X, Sicredi, C-Trends etc). Você sempre confere antes de salvar
- Geocodificação automática do endereço (localiza no mapa), limitada à região de Ponta Porã/MS (inclui Itamarati e Sanga Puitã) — evita que um endereço parecido de outra cidade do Brasil seja encontrado por engano. Se o endereço completo não for encontrado dentro dessa região, tenta de novo com versões mais simples até achar ao menos a cidade
- Ajuste manual no mapa: na tela de cadastro/edição de OS, dá pra abrir um mapa e arrastar o marcador para corrigir a localização quando a busca automática erra ou não encontra
- Montagem de rota: seleciona as OS pendentes, escolhe um ponto de partida (endereço ou GPS do celular) e o app calcula a melhor ordem de visita
- Parada rápida direto na tela de rota: só cliente e endereço são obrigatórios (serviço, máquina, contato e observações são opcionais) — não precisa passar pelo cadastro completo de OS pra adicionar uma parada
- Edição da rota: reordenar manualmente (▲▼), remover parada, "deixar pra depois" (manda a parada pro final da rota), reotimizar
- Observação por parada: pode anotar algo específico daquela entrega direto na tela da rota
- Tela de "dia a dia": lista das paradas em ordem, botões para abrir no Google Maps, Waze ou mandar mensagem no WhatsApp (quando a OS tem contato), marcar como concluída
- Balão flutuante na tela da rota: mostra sempre a próxima parada pendente, pequeno por padrão e expande ao tocar com endereço, cliente e observações
- Funciona offline como app instalado no celular (PWA)

## Como rodar local para testar

Precisa de um servidor local simples (não pode abrir o `index.html` direto por causa dos módulos JS). Com Python instalado:

```bash
python -m http.server 8798
```

Depois abra `http://localhost:8798` no navegador.

## Como colocar no ar de graça (GitHub Pages)

1. Crie um repositório novo no GitHub (pode ser privado)
2. Suba todos os arquivos desta pasta para o repositório
3. No repositório: **Settings → Pages → Source** → escolha a branch `main` e a pasta `/ (root)`
4. Em alguns minutos o app fica disponível em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`
5. No celular, abra esse link no Chrome e use **"Adicionar à tela inicial"** — o app passa a abrir como um aplicativo normal

Não precisa pagar nada: GitHub Pages é grátis, e o banco de dados (Supabase) também está no plano gratuito.

## Banco de dados (Supabase)

Já está tudo configurado e funcionando (projeto `rotas-maquininhas`, plano gratuito, sem mensalidade). As chaves em `js/config.js` são públicas por design — a segurança é garantida por Row Level Security (cada login só enxerga seus próprios dados).

**Confirmação de e-mail:** já está resolvido — existe um gatilho no banco (`trg_auto_confirm_email`) que confirma automaticamente qualquer conta nova assim que ela é criada, então dá pra criar contas (para você ou sua equipe) e já entrar direto, sem precisar clicar em link de e-mail nem depender do painel do Supabase.

## Serviços externos usados (todos gratuitos)

- **Geocodificação de endereço:** OpenStreetMap Nominatim — limite de ~1 endereço por segundo, respeitado automaticamente pelo app
- **Otimização de rota:** OSRM (servidor de demonstração público) — ótimo para uso pessoal/baixo volume. Se um dia o volume de entregas crescer muito, dá pra trocar por uma chave paga do OpenRouteService ou Mapbox sem mudar a estrutura do app
- **Mapa:** OpenStreetMap + Leaflet.js

## Limitações conhecidas (para evoluir depois)

- OCR da foto funciona melhor com foto nítida e texto impresso/digitado; texto manuscrito tem taxa de acerto menor — por isso sempre mostra os campos para conferência antes de salvar. Já reconhece os padrões dos modelos C6 Bank/FedEx, Cielo, Azulzinha X, Sicredi e C-Trends (ajustado a partir de fotos reais)
- Em cidades menores o OpenStreetMap pode não ter todas as ruas mapeadas — quando isso acontece, use o botão "Ver/ajustar localização no mapa" para marcar o ponto certo na mão
- Quando a rota é montada **sem** ponto de partida definido, o mapa mostra só os pontos (sem linha do trajeto) — para ver a linha, defina um endereço de partida ou use "Usar GPS"
- Sem importação de planilha/CSV por enquanto (cadastro é manual ou por foto)
