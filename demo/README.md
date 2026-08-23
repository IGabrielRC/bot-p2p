# bot-p2p — demo spike (`/tasa`)

Bot de Telegram desechable para validar demanda con Kelly. No es código de producción.

## 1. Crear el bot

1. Habla con [@BotFather](https://t.me/BotFather) en Telegram → `/newbot`.
2. Copia el token y pégalo en `demo/.env`:

```
BOT_TOKEN=123456:ABC...
ALLOWED_CHAT_ID=
```

(Parte de `demo/.env.example`; no subas `.env` al repo, ya está ignorado por git.)

## 2. Obtener tu chat id

Deja `ALLOWED_CHAT_ID` vacío la primera vez, corre el bot y mándale cualquier mensaje desde tu cuenta.
El bot lo ignora pero **loguea tu id en consola**:

```
[guard] ignored user 123456789 @tu_usuario
```

Pon ese número en `ALLOWED_CHAT_ID` y reinicia. Nadie más recibe respuesta del bot.

## 3. Correr local

```bash
npm install --prefix demo
npm start --prefix demo
```

## 4. Correr en VPS

```bash
cd demo && npm install
pm2 start index.js --name bot-p2p-demo   # opción A: pm2
```

Opción B — systemd (guardar como `/etc/systemd/system/bot-p2p-demo.service`):

```ini
[Unit]
Description=bot-p2p demo spike
After=network.target

[Service]
WorkingDirectory=/opt/bot-p2p/demo
ExecStart=/usr/bin/node index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Habilitar: `sudo systemctl enable --now bot-p2p-demo`.

## 5. Guion de video para Kelly (5 pasos)

1. **/start** — mostrar saludo y los tres botones.
2. **/tasa** — aparece la tarjeta con la tasa de mercado y los tres planes.
3. Tocar **🔄 Actualizar** — la misma tarjeta se refresca (no llegan mensajes nuevos).
4. **/calculo 300** — desglose completo; se ve la comisión de 3 € (aplica a montos ≤ 300 €).
5. **/calculo 400** — mismo desglose sin comisión.

Tip: grabar pantalla del chat y destacar que el bot responde al instante.

## Nota sobre fuentes de tasa

- Primario: Binance P2P (BAPI). Si está bloqueado desde esta máquina/IP, el bot
  usa `usdt.com.ve` automáticamente y marca la tarjeta con
  *(fuente alternativa — solo prueba)*.
- Si ninguna fuente responde, avisa amablemente y nunca muestra números inventados.
