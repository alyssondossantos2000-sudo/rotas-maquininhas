package com.rotasmaquininhas.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(BubbleOverlayPlugin.class);
    super.onCreate(savedInstanceState);
  }

  // A bolha flutuante (BubbleOverlayService) traz o app de volta pra frente com uma ação pendente
  // nos extras em vez de tentar mexer no Supabase direto do Java (o login/sessão só existe no lado
  // JS) — aqui a gente só repassa essa ação pro JS via um evento customizado, e quem trata de
  // verdade (achar a OS, chamar o Supabase, re-renderizar) é o app.js já existente.
  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    despacharAcaoDaBolha(intent);
  }

  @Override
  public void onResume() {
    super.onResume();
    despacharAcaoDaBolha(getIntent());
  }

  private void despacharAcaoDaBolha(Intent intent) {
    if (intent == null) return;
    String acao = intent.getStringExtra("bubble_action");
    if (acao == null) return;
    String osId = intent.getStringExtra("bubble_os_id");
    String rotaId = intent.getStringExtra("bubble_rota_id");
    // Remove do próprio Intent (mesmo objeto que getIntent() vai retornar depois) pra não disparar
    // essa mesma ação de novo se o app for pausado/resumido por outro motivo qualquer mais tarde.
    intent.removeExtra("bubble_action");

    if (getBridge() == null || getBridge().getWebView() == null) return;
    String js = "window.dispatchEvent(new CustomEvent('bolhaAcao', { detail: { acao: '"
      + acao + "', osId: '" + (osId == null ? "" : osId) + "', rotaId: '" + (rotaId == null ? "" : rotaId) + "' } }));";
    getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(js, null));
  }
}
