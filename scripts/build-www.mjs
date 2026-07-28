// Copia só o que o app nativo (Capacitor/APK) precisa pra www/ — SEM bundler, é cópia de arquivo
// mesmo, mantendo o espírito "zero build step" do projeto. O site em si (GitHub Pages) continua
// servindo os arquivos originais direto da raiz, sem depender dessa pasta.
//
// De propósito NÃO copia: fotos-teste/ (fotos reais de cliente — não pode ir pro APK de jeito
// nenhum), test/ (harness de teste, é coisa de desenvolvimento), README/CONTEXTO*.md (documentação).
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as esbuild from "esbuild";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const destino = path.join(raiz, "www");

const ARQUIVOS_E_PASTAS = ["index.html", "manifest.json", "css", "js", "icons"];

if (existsSync(destino)) rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });

for (const nome of ARQUIVOS_E_PASTAS) {
  const origem = path.join(raiz, nome);
  if (!existsSync(origem)) {
    console.warn(`build-www: "${nome}" não existe, pulando.`);
    continue;
  }
  cpSync(origem, path.join(destino, nome), { recursive: true });
}

// Único ponto do projeto que passa por bundler — os pacotes nativos do Capacitor têm dependências
// internas (ex: "synapse") que só resolvem direito assim; tentar simular com <script> globais
// soltos dava "ReferenceError: synapse is not defined" (achado testando no celular real). O
// resto do app continua zero-build-step. Ver native/entry.js pro porquê completo.
const vendorDestino = path.join(destino, "vendor");
mkdirSync(vendorDestino, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(raiz, "native", "entry.js")],
  bundle: true,
  format: "iife",
  outfile: path.join(vendorDestino, "native-plugins.js"),
});

console.log(`build-www: copiado pra ${destino}`);
