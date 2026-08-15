package com.rotasmaquininhas.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

// Serviço em primeiro plano que desenha a bolha (e o painel expandido) por cima de qualquer outro
// app na tela — é o que permite ver/agir na próxima parada sem precisar voltar pro nosso app
// enquanto o Maps/Waze tá navegando. A notificação de primeiro plano é obrigatória a partir do
// Android 8 pra esse tipo de serviço não ser matado pelo sistema; deixamos ela na prioridade mínima
// (MIN) pra não incomodar — ela só existe pra manter o serviço vivo, não é uma notificação de
// verdade pro usuário interagir.
public class BubbleOverlayService extends Service {
  private static final String CANAL_ID = "bolha_rota";
  private static final int NOTIF_ID = 4501;

  private WindowManager windowManager;
  private View bolhaView;
  private View painelView;
  private WindowManager.LayoutParams bolhaParams;
  private boolean painelAberto = false;

  private String rotaId, osId, label, endereco, bancoServico, mapsUrl, wazeUrl, whatsUrl;
  private int numero = 1;

  @Override
  public void onCreate() {
    super.onCreate();
    windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
    iniciarNotificacaoForeground();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null) {
      rotaId = intent.getStringExtra("rotaId");
      osId = intent.getStringExtra("osId");
      label = intent.getStringExtra("label");
      endereco = intent.getStringExtra("endereco");
      bancoServico = intent.getStringExtra("bancoServico");
      mapsUrl = intent.getStringExtra("mapsUrl");
      wazeUrl = intent.getStringExtra("wazeUrl");
      whatsUrl = intent.getStringExtra("whatsUrl");
      numero = intent.getIntExtra("numero", 1);
    }
    if (bolhaView == null) criarBolha(); else atualizarBolha();
    if (painelView != null) preencherPainel(painelView);
    return START_NOT_STICKY;
  }

  private void iniciarNotificacaoForeground() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel canal = new NotificationChannel(CANAL_ID, "Rota em andamento", NotificationManager.IMPORTANCE_MIN);
      NotificationManager nm = getSystemService(NotificationManager.class);
      nm.createNotificationChannel(canal);
    }
    Notification notif = new NotificationCompat.Builder(this, CANAL_ID)
      .setContentTitle("Rota em andamento")
      .setContentText("Bolha da próxima parada ativa")
      .setSmallIcon(android.R.drawable.ic_menu_mylocation)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .build();
    startForeground(NOTIF_ID, notif);
  }

  private int tipoOverlay() {
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
      ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      : WindowManager.LayoutParams.TYPE_PHONE;
  }

  private void criarBolha() {
    bolhaView = LayoutInflater.from(this).inflate(R.layout.bolha_flutuante, null);
    bolhaParams = new WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      tipoOverlay(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT
    );
    bolhaParams.gravity = Gravity.TOP | Gravity.START;
    bolhaParams.x = 16;
    bolhaParams.y = 400;

    atualizarBolha();

    // Arrastar move a bolha; um toque rápido (sem arrastar) abre/fecha o painel — distingue os dois
    // pela distância percorrida entre o toque inicial e o final.
    bolhaView.setOnTouchListener(new View.OnTouchListener() {
      private int xInicial, yInicial;
      private float touchXInicial, touchYInicial;
      private boolean moveu = false;

      @Override
      public boolean onTouch(View v, MotionEvent event) {
        switch (event.getAction()) {
          case MotionEvent.ACTION_DOWN:
            xInicial = bolhaParams.x;
            yInicial = bolhaParams.y;
            touchXInicial = event.getRawX();
            touchYInicial = event.getRawY();
            moveu = false;
            return true;
          case MotionEvent.ACTION_MOVE:
            int dx = (int) (event.getRawX() - touchXInicial);
            int dy = (int) (event.getRawY() - touchYInicial);
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moveu = true;
            bolhaParams.x = xInicial + dx;
            bolhaParams.y = yInicial + dy;
            windowManager.updateViewLayout(bolhaView, bolhaParams);
            return true;
          case MotionEvent.ACTION_UP:
            if (!moveu) alternarPainel();
            return true;
        }
        return false;
      }
    });

    windowManager.addView(bolhaView, bolhaParams);
  }

  private void atualizarBolha() {
    if (bolhaView == null) return;
    TextView numTv = bolhaView.findViewById(R.id.bolha_numero);
    numTv.setText(String.valueOf(numero));
  }

  private void alternarPainel() {
    if (painelAberto) { removerPainel(); return; }
    criarPainel();
  }

  private void criarPainel() {
    painelView = LayoutInflater.from(this).inflate(R.layout.painel_flutuante, null);
    WindowManager.LayoutParams painelParams = new WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      tipoOverlay(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT
    );
    painelParams.gravity = Gravity.TOP | Gravity.START;
    painelParams.x = bolhaParams.x;
    painelParams.y = bolhaParams.y + 140;

    preencherPainel(painelView);
    windowManager.addView(painelView, painelParams);
    painelAberto = true;
  }

  private void preencherPainel(View v) {
    ((TextView) v.findViewById(R.id.painel_nome)).setText(label);
    ((TextView) v.findViewById(R.id.painel_endereco)).setText("📍 " + endereco);

    TextView bancoTv = v.findViewById(R.id.painel_banco);
    if (bancoServico != null && !bancoServico.isEmpty()) {
      bancoTv.setText(bancoServico);
      bancoTv.setVisibility(View.VISIBLE);
    } else {
      bancoTv.setVisibility(View.GONE);
    }

    v.findViewById(R.id.painel_fechar).setOnClickListener(view -> removerPainel());
    v.findViewById(R.id.painel_maps).setOnClickListener(view -> abrirUrlExterna(mapsUrl));
    v.findViewById(R.id.painel_waze).setOnClickListener(view -> abrirUrlExterna(wazeUrl));

    View whatsBtn = v.findViewById(R.id.painel_whatsapp);
    if (whatsUrl != null && !whatsUrl.isEmpty()) {
      whatsBtn.setVisibility(View.VISIBLE);
      whatsBtn.setOnClickListener(view -> abrirUrlExterna(whatsUrl));
    } else {
      whatsBtn.setVisibility(View.GONE);
    }

    v.findViewById(R.id.painel_entregue).setOnClickListener(view -> despacharAcao("entregue"));
    v.findViewById(R.id.painel_adiar).setOnClickListener(view -> despacharAcao("adiar"));
    v.findViewById(R.id.painel_abrir_app).setOnClickListener(view -> abrirApp());
  }

  // Só traz o app de volta pra frente, sem nenhuma ação pendente pra aplicar.
  private void abrirApp() {
    Intent intent = new Intent(this, MainActivity.class);
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    startActivity(intent);
    removerPainel();
  }

  private void abrirUrlExterna(String url) {
    if (url == null || url.isEmpty()) return;
    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    startActivity(intent);
  }

  // Concluir/adiar precisam do login e da lógica que já existem no app (Supabase, RLS, reordenar
  // a rota) — em vez de duplicar tudo isso em Java, a bolha só traz o app de volta pra frente com a
  // ação pendente nos extras, e o MainActivity repassa isso pro JS (ver onNewIntent/onResume lá).
  private void despacharAcao(String acao) {
    Intent intent = new Intent(this, MainActivity.class);
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    intent.putExtra("bubble_action", acao);
    intent.putExtra("bubble_os_id", osId);
    intent.putExtra("bubble_rota_id", rotaId);
    startActivity(intent);
    removerPainel();
  }

  private void removerPainel() {
    if (painelView != null) {
      try { windowManager.removeView(painelView); } catch (Exception ignored) {}
      painelView = null;
    }
    painelAberto = false;
  }

  @Override
  public void onDestroy() {
    super.onDestroy();
    removerPainel();
    if (bolhaView != null) {
      try { windowManager.removeView(bolhaView); } catch (Exception ignored) {}
      bolhaView = null;
    }
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) { return null; }
}
