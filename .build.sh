#!/bin/bash

echo "🛠️ Installation des dépendances avec --legacy-peer-deps..."
npm install --legacy-peer-deps

echo "🚀 Lancement du serveur..."
npm run start
