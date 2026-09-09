FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright COLLECTOR_HEADLESS=true CONTEST_DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright && npm cache clean --force
COPY server ./server
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:4310/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
