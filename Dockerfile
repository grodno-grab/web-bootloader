FROM node:24.14.1-alpine3.23

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY index.html vite.config.ts tsconfig.json .env ./
COPY src/ ./src/

CMD ["npm", "run", "build"]
