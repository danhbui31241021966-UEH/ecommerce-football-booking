# Service gửi mail GGO. Build từ gốc repo (CHƯA được build thử: máy phát triển không có Docker):
#   docker build -f deploy/mail/Dockerfile -t ggo-mail .
# Không có secret trong image: mọi cấu hình đọc từ biến môi trường lúc chạy (xem README, mục Docker).
FROM node:22-alpine AS deps
WORKDIR /app
COPY deploy/mail/package.json deploy/mail/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production MAIL_PORT=8090
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY src/mail ./src/mail
USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.MAIL_PORT+'/mail-api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/mail/server.js"]
