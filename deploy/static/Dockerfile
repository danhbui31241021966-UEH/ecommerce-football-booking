# Image bản tĩnh chế độ dữ liệu mẫu (giống Cloudflare Pages). Build từ gốc repo:
#   docker build -f deploy/static/Dockerfile -t ggo-static .
# Chỉ những file liệt kê trong Dockerfile.dockerignore (danh sách cho phép) vào context, nên .env và mã BE không vào image.
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN node scripts/static-build.mjs dist --nginx-redirects redirects.conf --nginx-headers headers.conf

FROM nginx:stable-alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY deploy/static/nginx.conf /etc/nginx/conf.d/ggo.conf
COPY --from=build /app/redirects.conf /etc/nginx/ggo/redirects.conf
COPY --from=build /app/headers.conf /etc/nginx/ggo/headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
