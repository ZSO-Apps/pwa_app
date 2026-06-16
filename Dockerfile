FROM node:18-alpine

WORKDIR /app

# Abhängigkeiten kopieren und installieren (Produktion)
COPY package*.json ./
RUN npm ci --omit=dev

# Restlichen Quellcode kopieren
COPY . .

# Port freigeben
EXPOSE 8080

# Standard-Befehl zum Starten
CMD ["npm", "start"]
