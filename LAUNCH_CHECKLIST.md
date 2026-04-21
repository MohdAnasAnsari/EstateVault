# EstateVault — Pre-Launch Checklist

**Target launch:** TBD  
**Last updated:** April 2026  
**Phase 7 completion checkpoint**

Mark each item `[x]` when confirmed. All items in **Critical** must be checked before go-live.

---

## 🔴 Critical — Must Complete Before Launch

### Infrastructure
- [ ] **Domain & SSL:** Production domain configured; Cloudflare SSL/TLS mode set to Full (Strict); certificates auto-renew
- [ ] **HSTS preload:** Domain submitted to https://hstspreload.org
- [ ] **DNS:** A/AAAA records point to production server; CNAME for API subdomain configured
- [ ] **Cloudflare CDN:** Zone active; CDN_URL env var set; R2 public bucket URL configured
- [ ] **PgBouncer:** Running on port 6432; PGBOUNCER_URL env var updated; connection tested
- [ ] **Redis:** Production Redis instance provisioned; REDIS_URL env var updated; persistence enabled (AOF)
- [ ] **Database:** Production PostgreSQL 16 with pgvector; all 8 migrations applied (`db:migrate`)
- [ ] **Database indexes:** `0007_phase7.sql` migration run; EXPLAIN ANALYZE verified on key queries
- [ ] **Backups:** `scripts/backup-db.sh` scheduled via cron (0 2 * * *); first backup completed successfully; restore tested
- [ ] **Docker:** All containers healthy (postgres, redis, pgbouncer, meilisearch); `docker-compose ps` all Up

### Security
- [ ] **Secrets rotated:** All `.env` secrets replaced with production-strength random values (NEXTAUTH_SECRET, SESSION_SECRET, CSRF_SECRET ≥ 32 chars)
- [ ] **MOCK_SERVICES=false:** Confirmed in production `.env`
- [ ] **Real integrations verified:** Jumio, Twilio, Resend, OpenAI, Stripe, DLD all returning real responses
- [ ] **TOTP 2FA:** Tested end-to-end for Level 3 user (setup → QR → verify → login with code)
- [ ] **Brute force:** 10 failed logins trigger 1h lockout; tested manually
- [ ] **Rate limits:** Per-endpoint limits verified (login: 20/15min, register: 10/15min, OTP: 5/10min)
- [ ] **Session cookies:** `vault_token` cookie has `HttpOnly; Secure; SameSite=Strict` in production (check DevTools)
- [ ] **Helmet headers:** Verified via https://securityheaders.com (target: A rating)
- [ ] **CORS:** Only production domain(s) in allowlist; localhost removed
- [ ] **File uploads:** File type validation active; ClamAV reachable on CLAMAV_HOST:CLAMAV_PORT
- [ ] **SQL injection:** Drizzle ORM parameterised queries confirmed; no raw SQL with user input
- [ ] **XSS:** DOMPurify applied to all user-HTML rendering in web app; CSP headers set
- [ ] **Dependency audit:** `pnpm audit --audit-level=high` shows 0 high/critical vulnerabilities

### Authentication & Authorisation
- [ ] **JWT secret:** Production NEXTAUTH_SECRET is unique, random, ≥ 32 chars
- [ ] **Token expiry:** 7-day expiry confirmed; refresh flow working
- [ ] **Role checks:** Admin endpoints tested — buyer/seller cannot access admin routes
- [ ] **Level gates:** Level 1 cannot see price/off-market; Level 2 can; Level 3 full access
- [ ] **KYC gating:** Unverified users blocked from deal rooms and offer submission

### Database
- [ ] **Connection pooling:** API `DATABASE_URL` points to PgBouncer (port 6432) in production
- [ ] **Pool size tuned:** PgBouncer `default_pool_size` matches expected peak concurrency
- [ ] **Slow query logging:** Queries >100ms logged (hook in `src/index.ts` active)
- [ ] **pg_stat_statements:** Extension enabled for query analysis
- [ ] **Vacuum/Analyze:** `VACUUM ANALYZE` run on all major tables post-migration
- [ ] **Read replica:** (Optional but recommended) replica configured for read-heavy analytics queries

### Performance
- [ ] **k6 load test run:** `k6 run k6/load-test.js` against staging; results saved to `k6/load-test-results.json`
- [ ] **SLA verified:** p95 listing queries <500ms; p95 deal rooms <1s; confirmed in k6 output
- [ ] **Next.js build:** `pnpm build` completes with no errors; bundle size acceptable
- [ ] **Image optimisation:** Next.js Image component used for all listing photos; CDN hostname in `next.config.ts` `remotePatterns`
- [ ] **React.lazy:** Calculator, MarketIntelligence, Portfolio, ComparableSales dynamically imported
- [ ] **API caching:** Listing detail cache (TTL 5min) active; `cacheDel` called on listing update
- [ ] **Socket.io Redis adapter:** Confirmed in API logs: "Socket.IO Redis adapter attached"
- [ ] **Meilisearch:** Production index populated; AI embeddings generated for all active listings

### Monitoring & Observability
- [ ] **Sentry (API):** SENTRY_DSN set; test error captured in Sentry dashboard
- [ ] **Sentry (Web):** NEXT_PUBLIC_SENTRY_DSN set; frontend error captured
- [ ] **Health endpoint:** `GET /api/health` returns `{ status: 'ok', services: { database: 'ok', redis: 'ok' } }`
- [ ] **Pino logging:** Structured JSON logs in production (`NODE_ENV=production`); log drain configured (e.g. Logtail, Datadog)
- [ ] **Grafana dashboard:** Connected to production metrics; DAU, deal rooms, NDAs, offers, AI API usage panels live
- [ ] **Alerting:** Alerts set up for: error rate >1%, API p95 >800ms, health endpoint down, disk space >80%
- [ ] **Uptime monitoring:** External uptime check configured (e.g. BetterUptime, Checkly) on `/api/health`

---

## 🟡 Important — Should Complete Before Launch

### Legal & Compliance
- [ ] **Privacy Policy:** Accessible at `/privacy` on production; dated and accurate
- [ ] **Terms of Service:** Accessible at `/terms` on production; dated and accurate
- [ ] **AML Policy:** Internal policy reviewed and approved by Board
- [ ] **Data Processing Agreement:** DPA reviewed by legal counsel; updated with real sub-processor addresses
- [ ] **Cookie banner:** Consent banner implemented for analytics cookies (GDPR requirement)
- [ ] **UAE goAML:** VAULT registered with UAE FIU goAML platform for SAR filing
- [ ] **RERA compliance:** All agent users have verified RERA ORN; expiry reminder job active
- [ ] **DLD integration:** DLD_API_KEY set; title deed verification returning real results

### User Experience
- [ ] **Email templates:** All transactional emails (welcome, verification, password reset, meeting confirmation) reviewed and branded
- [ ] **Error pages:** Custom 404 and 500 pages implemented
- [ ] **Loading states:** All heavy components have Suspense fallback skeletons
- [ ] **Mobile responsiveness:** All pages tested on iOS Safari and Android Chrome at 375px viewport
- [ ] **RTL layout:** Arabic RTL layout tested; dir="rtl" applied correctly; typography renders correctly
- [ ] **Accessibility:** WCAG 2.1 AA: keyboard navigation, ARIA labels, colour contrast ≥4.5:1

### API & Integration
- [ ] **OpenAI:** API key set; embedding generation tested on listing creation; AI concierge responding
- [ ] **Stripe:** Production keys set; Pro subscription checkout flow tested end-to-end
- [ ] **Twilio:** Production credentials set; OTP SMS delivery verified
- [ ] **Resend:** Production API key set; email delivery verified; custom domain email configured
- [ ] **Mapbox:** Production token set; map rendering on listing detail page
- [ ] **TURN servers:** Cloudflare TURN credentials set; WebRTC video call tested between two users

### Background Jobs
- [ ] **listing-liveness:** Job runs daily at 04:00 UTC; auto-pauses stale listings correctly
- [ ] **listing-fraud-check:** Job processes new listings within 5 minutes of creation
- [ ] **aml-screening:** Job completes within 30 seconds of user registration
- [ ] **ai-matching:** Job generates buyer-listing matches; scores appear in buyer dashboard
- [ ] **rera-reminder:** Sends reminders 30/7/1 days before RERA expiry
- [ ] **BullMQ:** All queues healthy in dashboard; dead-letter queue monitored

### Security (Additional)
- [ ] **Pen test:** External penetration test scheduled or completed within 6 months of launch
- [ ] **Vulnerability disclosure:** security@vault.ae mailbox active; responsible disclosure policy published
- [ ] **2FA enforcement:** Level 3 users prompted to enable 2FA on first login
- [ ] **Session invalidation:** Changing password clears all active sessions
- [ ] **Rate limit monitoring:** Rate limit exceeded events surfaced in monitoring dashboard

---

## 🟢 Nice to Have — Post-Launch Enhancements

### Scalability
- [ ] **Horizontal scaling:** Multiple API instances behind load balancer tested (Socket.IO Redis adapter verified with 2+ instances)
- [ ] **Read replica:** PostgreSQL read replica for analytics/reporting queries
- [ ] **Redis Cluster/Sentinel:** High-availability Redis with automatic failover
- [ ] **CDN caching rules:** Static assets (JS/CSS) cached at edge with long max-age; HTML/API excluded
- [ ] **k6 CI integration:** Load test runs automatically in CI pipeline on staging

### Features
- [ ] **Grafana:** Custom dashboards for DAU, deal room activity, NDA rate, AI API cost tracking
- [ ] **Admin audit log:** All admin actions surfaced in Admin Dashboard > Audit Log
- [ ] **Mobile app:** React Native Expo app submitted to App Store and Google Play
- [ ] **API versioning:** `/api/v2` scaffolded for future breaking changes
- [ ] **OpenAPI spec:** Auto-generated Swagger UI at `/api/docs`

### Compliance
- [ ] **ISO 27001:** Roadmap to certification documented
- [ ] **SOC 2 Type I:** Preparation started
- [ ] **Data retention automation:** Automated deletion job for expired data (per Privacy Policy retention schedules)
- [ ] **DPIA:** Data Protection Impact Assessment completed for high-risk processing activities

---

## Sign-Off

| Role | Name | Sign-Off Date |
|---|---|---|
| Engineering Lead | | |
| Security Lead | | |
| Compliance Officer | | |
| Product Manager | | |
| CEO / Founder | | |

---

*All checklist items marked Critical must be completed and signed off before production traffic is routed to the platform.*
