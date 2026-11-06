FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/sqlite

ENV NODE_ENV=production
ENV PORT=5600

EXPOSE 5600

CMD ["npm", "start"]
