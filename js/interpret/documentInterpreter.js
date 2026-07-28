// Interpreta os blocos reconstruídos por layout/blockDetection.js e extrai os campos de uma OS de
// maquininha (Cliente, Endereço, Nº OS, Banco, Serviço, Contato). NÃO é IA — é baseado em regra +
// geometria (o projeto é 100% gratuito, sem API paga de LLM). Evolução direta do parseOsFields
// testado a sessão inteira com fotos reais, agora operando bloco a bloco (o que resolve sozinho um
// bug que existia antes: um cabeçalho de seção tipo "DADOS DO CLIENTE:" ficava no MESMO texto
// achatado que o campo de verdade e às vezes vencia a busca; como blocos diferentes normalmente
// viram blocos separados, a busca bloco-a-bloco já favorece o campo certo).
//
// `tipoSelecionado` (opcional): quando o usuário sabe de antemão o tipo de máquina/formulário
// (menu na tela de foto), usamos isso pra fixar o banco direto (sem adivinhar) e pra priorizar o
// rótulo certo por layout (ex: Sicredi usa "Razão Social", não "Cliente").
import {
  PADRAO_TELEFONE,
  encontrarPrimeiro,
  apenasDigitos,
} from "../layout/fieldDetection.js?v=14";

// Marcas/adquirentes comuns nos formulários de OS de maquininha — usadas pra descobrir o "banco"
// quando o documento não tem um rótulo "Banco:" explícito (o mais comum na prática) e o usuário
// não selecionou o tipo manualmente.
const BRAND_PATTERNS = [
  [/c6\s*pay|c6\s*bank/i, "C6 Bank"],
  [/\bcielo\b/i, "Cielo"],
  [/\bstone\b/i, "Stone"],
  [/\bgetnet\b/i, "GetNet"],
  [/pagbank|pagseguro/i, "PagBank"],
  [/\bsicredi\b/i, "Sicredi"],
  [/safrapay/i, "SafraPay"],
  [/mercado\s*pago|mercadopago/i, "Mercado Pago"],
  [/azulzinha/i, "Azulzinha"],
  [/\bvero\b/i, "Vero"],
  [/fiserv/i, "Fiserv"],
  [/infinitepay/i, "InfinitePay"],
  [/c-?trends/i, "C-Trends"],
  [/\brede\b/i, "Rede"],
  [/\bton\b/i, "Ton"],
];

// Nos formulários muitas vezes vários campos ficam na mesma linha (colunas lado a lado, ou o OCR
// gruda um pedaço do campo vizinho na mesma "linha" detectada) — a captura de um campo de texto
// livre para no próximo rótulo conhecido, não só no fim do bloco.
const LABEL_WORDS = "N[UÚ]MERO|N[°ºO]\\.?\\s*OS|DATA|CEP|CIDADE|BAIRRO|CONTATO|CELULAR|RAZ[AÃ]O|NOME|CLIENTE|ENDERE[CÇ]O|REFER[EÊ]NCIA|TIPO|RAMO|PRAZO|VALOR|C[OÓ]D|DOC|MERCHANT|TOKEN";
const NEXT_LABEL = `(?=\\s{2,}|\\s+(?:${LABEL_WORDS})\\b|$)`;

function confiancaMediaDoBloco(bloco) {
  const valores = bloco.linhas.flatMap((l) => l.palavras.map((p) => p.confianca)).filter((c) => c != null);
  if (!valores.length) return null;
  return +(valores.reduce((a, b) => a + b, 0) / valores.length).toFixed(2);
}

function bboxDoBloco(bloco) {
  return [bloco.x0, bloco.y0, bloco.x1, bloco.y1];
}

// Procura os padrões bloco a bloco (na ordem em que aparecem no documento), pattern por pattern
// dentro de cada bloco, pulando capturas "vazias de conteúdo" (só pontuação/ruído do OCR) e
// continuando pra próxima ocorrência — evita que um cabeçalho de seção vença a busca.
function buscarCampo(blocos, patterns, valorValido) {
  for (const bloco of blocos) {
    for (const re of patterns) {
      const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
      const global = new RegExp(re.source, flags);
      let m;
      while ((m = global.exec(bloco.texto))) {
        const valor = (m[1] || "").trim();
        if (valorValido(valor)) {
          return { valor, bloco, confianca: confiancaMediaDoBloco(bloco), bbox: bboxDoBloco(bloco) };
        }
        if (m.index === global.lastIndex) global.lastIndex++;
      }
    }
  }
  return null;
}

const temConteudo = (v) => /[a-zà-ÿ]{2,}/i.test(v);
const temDigito = (v) => /\d{2,}/.test(v);

function campoOuVazio(resultado, label) {
  if (!resultado) return { label, value: "", confidence: null, bbox: [] };
  return { label, value: resultado.valor, confidence: resultado.confianca, bbox: resultado.bbox };
}

export function interpretarDocumento(blocos, tipoSelecionado) {
  const textoCompleto = blocos.map((b) => b.texto).join("\n");

  // Número da OS — em formulário-tabela (ex: Sicredi: "TIPO DE SERVIÇO | NÚMERO DA OS | DATA |
  // SLA..." como cabeçalho de coluna, sem valor embaixo na mesma linha), a busca simples pegava a
  // palavra da próxima coluna como se fosse o número. Só aceita captura com dígito de verdade.
  const numeroOs = buscarCampo(
    blocos,
    [
      /n[uú]mero\s*(?:da\s*)?os\s*[:\-]?\s*([\w\-\/.]+)/i,
      /n[°ºo]\.?\s*os\s*[:\-]?\s*([\w\-\/.]+)/i,
      // "Ponto Referência:" é um campo de endereço/contato (ponto de referência do local) em
      // vários formulários, não sinônimo de número de OS — sem o (?<!ponto\s...), esse padrão
      // pegava o telefone que aparece nesse campo por engano (bug real achado nos testes).
      /(?<!ponto\s{0,4})refer[eê]ncia\s*[:\-]\s*([\w\-\/.]+)/i,
      /n[uú]mero\s*l[oó]gico\s*[:\-]\s*([\w\-\/.]+)/i,
      /merchant\s*id\s*(?:\/\s*pv)?\s*[:\-]\s*([\w\-\/.]+)/i,
    ],
    temDigito
  );
  let campoNumeroOs = campoOuVazio(numeroOs, "numero_os");
  if (!campoNumeroOs.value) {
    const m = textoCompleto.match(/\b\d{5,15}\b/);
    if (m) campoNumeroOs = { label: "numero_os", value: m[0], confidence: null, bbox: [] };
  }

  // Formulário tipo Sicredi identifica o cliente por "Razão Social", não por "Cliente:".
  const padroesCliente = /sicredi/i.test(tipoSelecionado || "")
    ? [
        new RegExp("raz[aã]o\\s*social\\s*[:\\-]\\s*(.+?)" + NEXT_LABEL, "im"),
        new RegExp("\\bcliente\\s*[:\\-]\\s*(.+?)" + NEXT_LABEL, "im"),
        /nome\s*fantasia\s*[:\-]\s*(.+)/i,
      ]
    : [
        new RegExp("\\bcliente\\s*[:\\-]\\s*(.+?)" + NEXT_LABEL, "im"),
        /nome\s*fantasia\s*[:\-]\s*(.+)/i,
        new RegExp("raz[aã]o\\s*social\\s*[:\\-]\\s*(.+?)" + NEXT_LABEL, "im"),
      ];
  const cliente = buscarCampo(blocos, padroesCliente, temConteudo);
  const campoCliente = campoOuVazio(cliente, "nome_cliente");

  const enderecoBase = buscarCampo(blocos, [/endere[cç]o\s*[:\-]\s*(.+)/i], temConteudo);
  const bairro = buscarCampo(blocos, [/bairro\s*[:\-]\s*(.+)/i], temConteudo);
  const cidade = buscarCampo(blocos, [/cidade\s*(?:\s*\/\s*uf)?\s*[:\-]\s*(.+)/i], temConteudo);
  const cep = buscarCampo(blocos, [/\bcep\s*[:\-]?\s*(\d{5}[\-.]?\d{3})\b/i], temDigito);
  const partesEndereco = [enderecoBase?.valor, bairro?.valor, cidade?.valor, cep?.valor].filter(Boolean);
  const campoEndereco = {
    label: "endereco",
    value: partesEndereco.join(", "),
    confidence: enderecoBase?.confianca ?? null,
    bbox: enderecoBase?.bbox ?? [],
  };

  const servico = buscarCampo(
    blocos,
    [
      new RegExp("tipo\\s*(?:de\\s*)?servi[cç]o\\s*[:\\-]\\s*(.+?)" + NEXT_LABEL, "im"),
      new RegExp("\\bservi[cç]o\\s*[:\\-]\\s*(.+?)" + NEXT_LABEL, "im"),
    ],
    temConteudo
  );
  const campoServico = campoOuVazio(servico, "servico");

  // Sabendo o tipo de antemão (menu na tela de foto), não precisa adivinhar o banco — evita pegar
  // uma marca errada que só aparece de passagem no texto (ex: lista de bandeiras aceitas).
  let campoBanco;
  if (tipoSelecionado) {
    campoBanco = { label: "banco", value: tipoSelecionado, confidence: 1, bbox: [] };
  } else {
    const bancoExplicito = buscarCampo(blocos, [/\bbanco\s*[:\-]\s*(.+)/i], temConteudo);
    if (bancoExplicito) {
      campoBanco = campoOuVazio(bancoExplicito, "banco");
    } else {
      let marca = null;
      for (const bloco of blocos) {
        for (const [re, label] of BRAND_PATTERNS) {
          if (re.test(bloco.texto)) { marca = { label, bloco }; break; }
        }
        if (marca) break;
      }
      campoBanco = marca
        ? { label: "banco", value: marca.label, confidence: confiancaMediaDoBloco(marca.bloco), bbox: bboxDoBloco(marca.bloco) }
        : { label: "banco", value: "", confidence: null, bbox: [] };
    }
  }

  // Telefone: prioriza campo "Celular:" isolado, depois procura um número dentro da linha
  // "Contato:" (que às vezes traz "Nome - telefone" tudo junto), depois rótulos genéricos. Não
  // tenta adivinhar telefone solto no resto do texto — arriscaria pegar número de série/maquineta
  // por engano; melhor deixar em branco do que errado.
  const contato = buscarCampo(
    blocos,
    [
      new RegExp("celular\\s*[:\\-]\\s*(" + PADRAO_TELEFONE.source + ")", "i"),
      new RegExp("contato\\s*[:\\-].*?(" + PADRAO_TELEFONE.source + ")", "i"),
      new RegExp("(?:telefone|tel\\.?|whats\\s*app|whatsapp|fone)\\s*[:\\-]\\s*(" + PADRAO_TELEFONE.source + ")", "i"),
    ],
    (v) => apenasDigitos(v).length >= 8
  );
  const campoContato = {
    label: "contato",
    value: contato ? apenasDigitos(contato.valor) : "",
    confidence: contato?.confianca ?? null,
    bbox: contato?.bbox ?? [],
  };

  const fields = [campoNumeroOs, campoCliente, campoEndereco, campoBanco, campoServico, campoContato];
  const confiancasValidas = fields.map((f) => f.confidence).filter((c) => c != null);
  const confidence = confiancasValidas.length
    ? +(confiancasValidas.reduce((a, b) => a + b, 0) / confiancasValidas.length).toFixed(2)
    : null;

  return {
    documentType: tipoSelecionado || campoBanco.value || "desconhecido",
    confidence,
    fields,
    textoBruto: textoCompleto,
  };
}

// Formato "legado" — os mesmos campos, no shape simples {numero_os, nome_cliente, ...} que o
// resto do app (formulários de OS) já espera. Mantido separado da interpretação estruturada
// (interpretarDocumento) pra não misturar "extrair" com "adaptar pro formato de um form específico".
export function paraCamposDeOs(resultado) {
  const porLabel = Object.fromEntries(resultado.fields.map((f) => [f.label, f.value]));
  return {
    numero_os: porLabel.numero_os || "",
    nome_cliente: porLabel.nome_cliente || "",
    endereco: porLabel.endereco || "",
    banco: porLabel.banco || "",
    servico: porLabel.servico || "",
    contato: porLabel.contato || "",
  };
}
