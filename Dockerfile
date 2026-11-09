FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# 本番で使う分（/prod_modules）と、組み立てに使う分を、続けて入れる。
# package-lock.json が変わらなければ、ここはキャッシュを使うので、更新のたびには入れ直さない（前は毎回 npm prune していた）
RUN npm ci --omit=dev && cp -a node_modules /prod_modules && npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# 型のチェックは push する前に済ませているので、ここでは変換だけ（--noCheck。出てくる JS は同じで、メモリ約 1.7GB → 1.2GB・時間も短い）
# メモリの少ない VPS では Node が使えるメモリを自動で小さくするので、組み立てのときだけ上限を広げる
RUN NODE_OPTIONS=--max-old-space-size=3072 npm run build:fast

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /prod_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY drizzle ./drizzle
# おみくじの紙を描く字（明朝体）
COPY assets ./assets
RUN mkdir -p /data/recordings && chown node:node /data/recordings && chmod 700 /data/recordings
# 🚀 いま動いている版（update.sh が入れる。社務所Web の更新履歴に出す）。毎回変わるので、いちばん後ろに置く
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "const p=process.env.HEALTH_PORT||'8080';if(p==='0')process.exit(0);fetch('http://localhost:'+p).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
