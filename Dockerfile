FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json index.html ./
COPY src ./src
COPY shared ./shared
COPY data/config.json ./data/config.json
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim
# Use Node's bundled trust roots to bootstrap HTTPS before installing system CAs
RUN node -e "require('node:fs').writeFileSync('/tmp/node-ca.pem', require('node:tls').rootCertificates.join('\n'))" \
    && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::https::CaInfo=/tmp/node-ca.pem -o Acquire::Retries=3 update \
    && apt-get -o Acquire::https::CaInfo=/tmp/node-ca.pem -o Acquire::Retries=3 install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* /tmp/node-ca.pem
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 \
    GIVEAWAY_PARTICIPANTS_FILE=/app/runtime/participants.json \
    GIVEAWAY_STATE_DIR=/app/runtime/state GIVEAWAY_OUTPUT_DIR=/app/runtime/output
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY data/config.json ./data/config.json
RUN mkdir -p /app/runtime/state /app/runtime/output && chown -R node:node /app/runtime
USER node
EXPOSE 4310
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:4310/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs", "--production"]
