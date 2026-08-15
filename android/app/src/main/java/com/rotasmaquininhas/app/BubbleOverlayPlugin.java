package com.rotasmaquininhas.app;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Ponte JS -> nativo pra bolha flutuante da rota (estilo "chat head" do Messenger), que continua
// visível por cima de outros apps (Maps, Waze) mesmo com o nosso app em segundo plano — pedido
// porque o balão flutuante de DENTRO do app (ver js/app.js updateFloatingWidget) some assim que o
// usuário sai pro Maps pra navegar até a parada.
@CapacitorPlugin(name = "BubbleOverlay")
public class BubbleOverlayPlugin extends Plugin {

  @PluginMethod
  public void checkPermission(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("granted", Settings.canDrawOverlays(getContext()));
    call.resolve(ret);
  }

  // Abre a tela de sistema pra usuário liberar "Exibir sobre outros apps" na mão — não tem como
  // conceder essa permissão programaticamente, é sempre um passo manual do Android.
  @PluginMethod
  public void requestPermission(PluginCall call) {
    Intent intent = new Intent(
      Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
      Uri.parse("package:" + getContext().getPackageName())
    );
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    getContext().startActivity(intent);
    call.resolve();
  }

  @PluginMethod
  public void show(PluginCall call) {
    if (!Settings.canDrawOverlays(getContext())) {
      call.reject("Permissão de sobrepor outros apps não concedida.");
      return;
    }
    Intent intent = new Intent(getContext(), BubbleOverlayService.class);
    intent.putExtra("rotaId", call.getString("rotaId"));
    intent.putExtra("osId", call.getString("osId"));
    intent.putExtra("label", call.getString("label"));
    intent.putExtra("endereco", call.getString("endereco"));
    intent.putExtra("bancoServico", call.getString("bancoServico"));
    intent.putExtra("mapsUrl", call.getString("mapsUrl"));
    intent.putExtra("wazeUrl", call.getString("wazeUrl"));
    intent.putExtra("whatsUrl", call.getString("whatsUrl"));
    Integer numero = call.getInt("numero");
    intent.putExtra("numero", numero == null ? 1 : numero);
    getContext().startForegroundService(intent);
    call.resolve();
  }

  @PluginMethod
  public void hide(PluginCall call) {
    getContext().stopService(new Intent(getContext(), BubbleOverlayService.class));
    call.resolve();
  }
}
