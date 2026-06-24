FROM node:18-alpine

WORKDIR /app


COPY --chown=node:node entrypoint.sh ./
RUN chmod +x entrypoint.sh

COPY package*.json ./
RUN npm ci --omit=dev

# Restlichen Quellcode kopieren
COPY . .

EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]

CMD ["npm", "start", "--", "Freiamt"]