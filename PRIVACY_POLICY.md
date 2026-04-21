# Privacy Policy

**Last updated:** April 2026  
**Effective date:** April 2026  
**Version:** 1.0

---

## 1. Introduction

EstateVault ("we", "us", "our") operates the VAULT platform — a private real estate marketplace for ultra-high-net-worth individuals, located at **vault.ae** and accessible via web and mobile applications. This Privacy Policy describes how we collect, use, store, share and protect your personal data, and explains your rights under:

- The **EU General Data Protection Regulation (GDPR)** (Regulation 2016/679)
- The **UAE Personal Data Protection Law (PDPL)** (Federal Decree-Law No. 45 of 2021)
- The **Dubai International Financial Centre (DIFC) Data Protection Law 2020**

We are committed to handling your personal data responsibly and transparently.

---

## 2. Data Controller

| | |
|---|---|
| **Entity name** | EstateVault DMCC |
| **Registered address** | Jumeirah Lakes Towers, Dubai, UAE |
| **Data Protection Officer** | privacy@vault.ae |
| **EU Representative** | vault-eu-rep@vault.ae |

---

## 3. What Data We Collect

### 3.1 Identity & Contact Data
- Full legal name (encrypted at rest)
- Email address
- Phone number
- Nationality
- Profile photo

### 3.2 KYC & Compliance Data
- Government-issued ID documents
- Proof of address
- Source of funds documentation
- Financial capacity range
- AML/PEP screening results

### 3.3 Property & Transaction Data
- Saved listings and search preferences
- Investment criteria (buyer briefs)
- Offer history and negotiation records
- Deal room messages (end-to-end encrypted)
- NDA signatures and hashes
- Portfolio entries

### 3.4 Technical Data
- IP address and device fingerprint (for fraud detection)
- Browser type and version
- Operating system
- Session tokens (HTTP-only, Secure, SameSite=Strict cookies)
- API access logs (request method, URL, response code, latency)

### 3.5 Usage & Analytics Data
- Pages visited and features used
- Search queries and filters applied
- Time spent on listings
- Error and crash reports (via Sentry)

### 3.6 Communication Data
- Support tickets
- Meeting requests and video call logs

---

## 4. Legal Basis for Processing

| Processing Purpose | Legal Basis (GDPR Art. 6) | UAE PDPL Equivalent |
|---|---|---|
| Account registration & authentication | Contract performance | Contractual necessity |
| KYC/AML compliance | Legal obligation | Regulatory obligation |
| Fraud prevention | Legitimate interests | Public interest / legitimate purpose |
| Platform features & deal rooms | Contract performance | Contractual necessity |
| Marketing communications | Consent | Consent |
| Analytics & product improvement | Legitimate interests | Legitimate purpose |
| Security monitoring & audit logs | Legitimate interests | Legitimate purpose |

---

## 5. How We Use Your Data

- **Account management:** To create and maintain your account, verify your identity, and provide access based on your KYC/access tier status.
- **Deal facilitation:** To connect buyers and sellers, manage deal rooms, process NDA signings, and facilitate offer exchanges (all messages are end-to-end encrypted).
- **Compliance:** To screen users against sanctions lists, PEP databases, and AML requirements as required by UAE and international regulations.
- **Security:** To detect fraud, prevent brute-force attacks, and maintain platform integrity using rate limiting, anomaly detection, and audit logging.
- **Communications:** To send transactional emails (account verification, meeting confirmations, offer notifications) and, with consent, marketing updates.
- **Improvement:** To analyse platform usage, fix bugs, and develop new features.

---

## 6. Data Sharing

We do not sell your personal data. We share data only as follows:

| Recipient | Purpose | Location |
|---|---|---|
| **Jumio** | Identity verification (KYC) | USA / EU |
| **OpenAI** | AI-powered search, matching, descriptions | USA |
| **Twilio** | SMS OTP delivery | USA / UAE |
| **Resend** | Transactional email delivery | USA |
| **Cloudflare R2** | Encrypted file storage | Global CDN |
| **Stripe** | Payment processing for subscriptions | USA |
| **Sentry** | Error tracking (anonymised) | USA |
| **UAE Regulatory Bodies** | AML/sanctions reporting as required by law | UAE |
| **Legal authorities** | Court orders, law enforcement requests | Varies |

All third-party processors are bound by Data Processing Agreements compliant with GDPR Article 28 and UAE PDPL requirements.

---

## 7. International Data Transfers

Where data is transferred outside the UAE or EEA, we ensure adequate safeguards through:
- EU Standard Contractual Clauses (SCCs) per GDPR Chapter V
- UAE PDPL transfer mechanisms
- Adequacy decisions where applicable

---

## 8. Data Retention

| Data Category | Retention Period |
|---|---|
| Account & KYC data | 7 years after account closure (regulatory requirement) |
| AML screening records | 10 years (FATF / UAE AML Law) |
| Deal room messages & NDAs | 7 years after deal closure |
| Audit logs | 5 years |
| Support tickets | 3 years |
| Marketing data | Until consent withdrawn + 30 days |
| Session cookies | 7 days (auto-expiry) |
| Backup snapshots | 30 days rolling |

---

## 9. Security Measures

We implement the following technical and organisational measures:

- **Encryption in transit:** TLS 1.3 on all connections; HSTS with preload
- **Encryption at rest:** AES-256 for stored files; libsodium XSalsa20-Poly1305 for deal room messages
- **Authentication:** Bcrypt (cost 12) password hashing; optional TOTP 2FA for Level 3 users; HTTP-only Secure SameSite=Strict session cookies
- **Access control:** Role-based access tiers (Level 1/2/3); KYC verification required for sensitive data
- **Brute-force protection:** Account lockout after 10 failed attempts for 1 hour
- **Penetration testing:** Annual third-party security assessment
- **Incident response:** 72-hour breach notification to supervisory authority (GDPR Art. 33); notification to UAE Cybersecurity Council as required

---

## 10. Your Rights

### Under GDPR (EU/EEA residents)
- **Right of access** (Art. 15): Request a copy of your personal data
- **Right to rectification** (Art. 16): Correct inaccurate data
- **Right to erasure** (Art. 17): Delete data where no legal obligation to retain
- **Right to restriction** (Art. 18): Limit processing in certain circumstances
- **Right to portability** (Art. 20): Receive data in machine-readable format
- **Right to object** (Art. 21): Object to legitimate interest or marketing processing
- **Right not to be subject to automated decisions** (Art. 22)

### Under UAE PDPL
- Right to access and obtain a copy of your data
- Right to correction of inaccurate data
- Right to erasure where lawfully applicable
- Right to data portability
- Right to withdraw consent at any time

### How to Exercise Your Rights
Submit a request to **privacy@vault.ae**. We will respond within **30 days** (GDPR) or **30 business days** (UAE PDPL). Identity verification may be required before processing requests.

---

## 11. Cookies

We use the following cookies:

| Cookie | Type | Purpose | Duration |
|---|---|---|---|
| `vault_token` | Essential | Authentication session | 7 days |
| `_sentry_sdk_session` | Functional | Error tracking session ID | Session |
| Analytics cookies | Analytical | Platform usage (anonymised) | 90 days |

You may withdraw cookie consent at any time through your browser settings or by contacting us. Essential cookies cannot be disabled as they are required for platform operation.

---

## 12. Children's Privacy

The platform is not directed at persons under 18 years of age. We do not knowingly collect personal data from minors. If you believe a minor has created an account, contact us immediately at privacy@vault.ae.

---

## 13. Changes to This Policy

We will notify registered users by email and display an in-platform banner at least **30 days** before material changes take effect. Continued use of the platform after the effective date constitutes acceptance.

---

## 14. Contact & Complaints

**Data Protection Officer:** privacy@vault.ae  
**Postal address:** EstateVault DMCC, Jumeirah Lakes Towers, Dubai, UAE

**EU supervisory authority:** You have the right to lodge a complaint with your local data protection authority. For UAE residents: **UAE Data Office** (dataoffice.ae).

---

*EstateVault DMCC — Registered in Dubai, UAE*
