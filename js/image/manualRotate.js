// Suporte ao botão "Girar" — o detector automático (autoRotate.js) pode ter confiança baixa numa
// foto ruim e não corrigir NADA mesmo com a foto de cabeça pra baixo (caso real encontrado em
// testes: uma foto ficou de cabeça pra baixo sem o OSD perceber). O usuário gira na mão, 90° por
// clique, e o pipeline reprocessa a foto inteira com essa rotação somada à automática.
export function proximaRotacaoManual(atual) {
  return (atual + 90) % 360;
}
