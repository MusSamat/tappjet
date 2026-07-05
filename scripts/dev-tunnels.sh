#!/usr/bin/env bash
# Restarts the Cloudflare quick tunnels for backend (:3000) + frontend (:3001)
# and rewires all env config to the new URLs. Run after every laptop sleep/reboot:
#   bash scripts/dev-tunnels.sh
# Then update the BotFather menu-button URL (printed at the end).
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$BACKEND_DIR/../tappjet_ft"
LOG_DIR="$BACKEND_DIR/var/tunnels"
CF="$HOME/.local/bin/cloudflared"
mkdir -p "$LOG_DIR"

echo "→ stopping old tunnels..."
pkill -f "cloudflared tunnel --url" 2>/dev/null || true
sleep 1

echo "→ starting tunnels..."
nohup "$CF" tunnel --url http://localhost:3000 --no-autoupdate > "$LOG_DIR/backend.log" 2>&1 &
nohup "$CF" tunnel --url http://localhost:3001 --no-autoupdate > "$LOG_DIR/frontend.log" 2>&1 &

B=""; F=""
for _ in $(seq 1 30); do
  B=$(grep -ohE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG_DIR/backend.log" 2>/dev/null | head -1 || true)
  F=$(grep -ohE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG_DIR/frontend.log" 2>/dev/null | head -1 || true)
  [ -n "$B" ] && [ -n "$F" ] && break
  sleep 1
done
[ -z "$B" ] || [ -z "$F" ] && { echo "✗ tunnels failed to start — see $LOG_DIR"; exit 1; }

echo "→ backend:  $B"
echo "→ frontend: $F"

echo "→ updating $FRONTEND_DIR/.env.local ..."
sed -i \
  -e "s|^NEXT_PUBLIC_API_URL=.*|NEXT_PUBLIC_API_URL=$B/v1|" \
  -e "s|^NEXT_PUBLIC_WS_URL=.*|NEXT_PUBLIC_WS_URL=${B/https:/wss:}|" \
  -e "s|^NEXT_PUBLIC_SITE_URL=.*|NEXT_PUBLIC_SITE_URL=$F|" \
  "$FRONTEND_DIR/.env.local"

echo "→ updating backend .env MINI_APP_URL ..."
sed -i "s|^MINI_APP_URL=.*|MINI_APP_URL=$F|" "$BACKEND_DIR/.env"
# tsx watch reloads .env only on a src change:
touch "$BACKEND_DIR/src/index.ts"

sleep 3
echo "→ verifying..."
curl -s -m15 -o /dev/null -w "  backend tunnel /health -> %{http_code}\n" "$B/health" || true
curl -s -m15 -o /dev/null -w "  frontend tunnel -> %{http_code}\n" "$F" || true

echo
echo "═══════════════════════════════════════════════════════"
echo "  OPEN ON PHONE:      $F"
echo "  UPDATE BOTFATHER:   /mybots → @tappjet_bot → Bot Settings"
echo "                      → Menu Button → set URL to:"
echo "                      $F"
echo "═══════════════════════════════════════════════════════"

# ─── Full production cycle: rebuild frontend with new URLs, restart, set bot button ───
if [ "${1:-}" = "--prod" ]; then
  echo "→ rebuilding frontend (URLs are baked into the production bundle)..."
  cd "$FRONTEND_DIR" && npm run build >/dev/null 2>&1 && echo "  build OK" || { echo "  ✗ build FAILED"; exit 1; }
  PID=$(ss -ltnp 2>/dev/null | grep ':3001' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
  [ -n "$PID" ] && kill "$PID" && sleep 1
  setsid npx next start -p 3001 > "$FRONTEND_DIR/var/prod-server.log" 2>&1 < /dev/null &
  for i in $(seq 1 30); do sleep 1; curl -s -m3 -o /dev/null http://localhost:3001 && break; done
  echo "  prod server restarted"
  TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$BACKEND_DIR/.env" | cut -d= -f2)
  if [ -n "$TOKEN" ]; then
    OK=$(curl -s -m10 -X POST "https://api.telegram.org/bot${TOKEN}/setChatMenuButton" -H "Content-Type: application/json" \
      -d "{\"menu_button\":{\"type\":\"web_app\",\"text\":\"🚗 Tappjet\",\"web_app\":{\"url\":\"$F/trips\"}}}" | grep -o '"ok":true')
    [ -n "$OK" ] && echo "  bot menu button updated automatically ✓" || echo "  ✗ bot button update failed — set manually in BotFather"
  fi
  echo "  ALL DONE — open on phone: $F"
fi
