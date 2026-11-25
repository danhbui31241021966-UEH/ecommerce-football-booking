# Label Traefik đề xuất cho container ggo-mail (chưa áp dụng lên VPS)

Cùng host với site tĩnh `ggo`, tách bằng PathPrefix. Router mail có `priority` rõ ràng và cao hơn router `ggo` (chỉ có Host).
Traefik mặc định đặt priority theo độ dài rule, nên không nên dựa vào đó: đặt tay 100, còn router `ggo` giữ mặc định (độ dài rule, vài chục), để `/mail-api` luôn tới service mail.

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.ggo-mail.rule=Host(`ggo.srv1741374.hstgr.cloud`) && PathPrefix(`/mail-api`)
  - traefik.http.routers.ggo-mail.priority=100
  - traefik.http.routers.ggo-mail.entrypoints=websecure
  - traefik.http.routers.ggo-mail.tls=true
  - traefik.http.routers.ggo-mail.tls.certresolver=letsencrypt
  - traefik.http.services.ggo-mail.loadbalancer.server.port=8090
```

Đi kèm: `MAIL_TRUST_PROXY=1` (đúng một Traefik trước container), container không publish cổng ra ngoài.
Tên entrypoint/certresolver (`websecure`, `letsencrypt`) lấy theo `deploy/static`; đối chiếu lại với cấu hình Traefik thật trên VPS trước khi áp dụng.

## Chạy container với secret từ file (chỉ đọc)

```yaml
volumes:
  - /opt/ggo-mail:/run/ggo-mail:ro
environment:
  - NODE_ENV=production
  - MAIL_TRANSPORT=smtp
  - MAIL_TRUST_PROXY=1
  - MAIL_ALLOWED_ORIGINS=https://ggo.srv1741374.hstgr.cloud
  - MAIL_TOKEN_SECRET_FILE=/run/ggo-mail/token-secret
  - SMTP_USER_FILE=/run/ggo-mail/smtp-user
  - SMTP_PASS_FILE=/run/ggo-mail/smtp-pass
```

Ba file trong `/opt/ggo-mail` chmod 600 và phải thuộc uid 1000 (user `node` của image), nếu không container không đọc được và không khởi động.
