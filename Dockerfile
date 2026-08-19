FROM node:22-slim

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY tsconfig.json vitest.config.ts ./
COPY src/ ./src/
COPY test/ ./test/

CMD ["npm", "test"]
