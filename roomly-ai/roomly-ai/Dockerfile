FROM node:20-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

RUN mkdir -p /app/data/uploads /app/data/generated

EXPOSE 3000

CMD ["npm", "start"]
