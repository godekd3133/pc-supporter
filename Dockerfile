FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=4174 \
    PC_SUPPORTER_DATA_DIR=/app/data \
    DANAWA_CRAWL_ON_START=false \
    BUILD_MONITOR_SCHEDULER_ENABLED=false

EXPOSE 4174

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4174/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["npm", "run", "start"]
