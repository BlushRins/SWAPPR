FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node assets/ assets/
COPY --chown=node:node lib/ lib/
COPY --chown=node:node public/ public/
COPY --chown=node:node scripts/reset-password.js scripts/reset-password.js
COPY --chown=node:node sql/courses.db sql/courses.db
COPY --chown=node:node seed.js server.js tailwind.config.js ./
RUN npm run build && npm prune --omit=dev && chown node:node /app/sql

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 SWAPPR_SQL_DIR=/app/sql
USER node
EXPOSE 3000
VOLUME ["/app/sql"]
CMD ["node", "server.js"]
