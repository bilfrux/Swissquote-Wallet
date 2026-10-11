#!/bin/sh
# Démo signet sur des ports dédiés (appli 5183, console 5184, Wallet du client 5180, bank-mock 4000),
# quand 5173/5174 sont pris par d'autres projets. Les validations : APP_URL=http://localhost:5183 CONSOLE_URL=http://localhost:5184
export BANK_MOCK_ORIGINS=http://localhost:5183,http://localhost:5184
export VITE_WALLET_ALLOWED_ORIGINS=http://localhost:5183
export VITE_GUARDIAN_CONSOLE_URL=http://localhost:5184
# Surveillance des comptes signet par bank-mock : 1 fois par heure (l'API Esplora publique est limitée à 700 requêtes/h/IP,
# partagées avec l'appli sur la même machine).
export ALERT_SIGNET_INTERVAL_MS=${ALERT_SIGNET_INTERVAL_MS:-3600000}
exec npx concurrently -n appli,bank,console,wallet \
  "VITE_BTC_NETWORK=signet npm run dev -w client -- --port 5183 --strictPort" \
  "npm run dev -w bank-mock" \
  "VITE_BTC_NETWORK=signet npm run dev -w guardian-console -- --port 5184 --strictPort" \
  "npm run dev -w client-wallet"
