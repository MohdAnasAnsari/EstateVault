# Data Processing Agreement (DPA)

**Version:** 1.0  
**Effective date:** April 2026

This Data Processing Agreement ("DPA") forms part of the agreement between **EstateVault DMCC** ("Data Processor" or "VAULT") and the counterparty identified in the executed Terms of Service ("Data Controller"). It supplements the Terms of Service and Privacy Policy and governs the processing of personal data by VAULT on behalf of the Data Controller where applicable.

Where VAULT processes personal data as a Data Controller in its own right (e.g., for its own KYC, AML, and platform security purposes), this DPA applies only to the extent VAULT acts as a Data Processor on behalf of third parties.

---

## 1. Definitions

| Term | Definition |
|---|---|
| **Personal Data** | Any information relating to an identified or identifiable natural person, as defined in GDPR Art. 4(1) and UAE PDPL |
| **Processing** | Any operation performed on personal data, including collection, storage, use, disclosure, or deletion |
| **Data Controller** | The entity determining the purposes and means of processing |
| **Data Processor** | VAULT, processing data on behalf of the Data Controller |
| **Sub-processor** | A third party engaged by VAULT to process personal data |
| **GDPR** | EU General Data Protection Regulation (Regulation 2016/679) |
| **UAE PDPL** | UAE Federal Decree-Law No. 45 of 2021 |

---

## 2. Scope of Processing

### 2.1 Subject Matter
VAULT processes personal data to provide the Platform services described in the Terms of Service, including:
- User identity verification and authentication
- Property listing management
- Deal room communications and file sharing
- KYC/AML compliance screening
- Analytics and platform improvement

### 2.2 Nature of Processing
Electronic processing of personal data through VAULT's web platform, mobile application, and backend infrastructure.

### 2.3 Duration
For the duration of the Data Controller's use of the Platform, plus any retention period required by applicable law (see Privacy Policy, Section 8).

### 2.4 Categories of Data Subjects
- End users of the Platform (buyers, sellers, agents, administrators)

### 2.5 Categories of Personal Data
- Identity data (name, email, phone, nationality)
- KYC documents (passport copies, proof of address)
- Financial data (offer amounts, source of wealth)
- Behavioural data (usage logs, search history)
- Communication data (support tickets, meeting records)

---

## 3. Obligations of VAULT as Data Processor

VAULT agrees to:

3.1 **Process only on instructions:** Process personal data only in accordance with the Data Controller's documented instructions (including as set out in these Terms) and applicable law.

3.2 **Confidentiality:** Ensure that persons authorised to process personal data are bound by confidentiality obligations.

3.3 **Security:** Implement technical and organisational measures appropriate to the risk, including those described in Section 9 of the Privacy Policy:
- Encryption in transit (TLS 1.3) and at rest (AES-256, libsodium)
- Access controls and role-based permissions
- Brute-force protection and session management
- Annual security assessments

3.4 **Sub-processors:** Not engage sub-processors without prior general authorisation from the Data Controller. The current list of sub-processors is set out in Annex 1. VAULT will notify Data Controllers of any changes to sub-processors giving at least **30 days' notice**.

3.5 **Data subject rights:** Assist the Data Controller in responding to data subject requests within applicable timescales.

3.6 **Breach notification:** Notify the Data Controller without undue delay (and in any event within **48 hours**) upon becoming aware of a personal data breach affecting Data Controller data.

3.7 **DPIAs:** Provide reasonable assistance to the Data Controller in relation to Data Protection Impact Assessments.

3.8 **Deletion or return:** Upon termination of the agreement, delete or return all personal data as directed by the Data Controller, except where retention is required by law.

3.9 **Audit rights:** Make available all information necessary to demonstrate compliance with this DPA and allow for and contribute to audits conducted by the Data Controller or an appointed auditor (with reasonable notice and at the Data Controller's expense).

---

## 4. International Data Transfers

Where personal data is transferred outside the EEA or UAE to third-party sub-processors:
- VAULT ensures appropriate safeguards are in place, including EU Standard Contractual Clauses (SCCs) per Commission Decision 2021/914
- UAE PDPL cross-border transfer mechanisms are applied where required
- VAULT maintains records of all cross-border transfers and safeguards

---

## 5. Annex 1 — Authorised Sub-Processors

| Sub-processor | Location | Processing Purpose | Safeguard |
|---|---|---|---|
| **Jumio Inc.** | USA | Identity verification (KYC) | SCCs + SOC 2 Type II |
| **OpenAI, Inc.** | USA | AI processing (search, matching, content) | SCCs + Data Processing Addendum |
| **Twilio Inc.** | USA | SMS delivery | SCCs + ISO 27001 |
| **Resend Inc.** | USA | Email delivery | SCCs |
| **Cloudflare R2** | Global | Encrypted file storage | SCCs + EU-US DPF |
| **Stripe, Inc.** | USA | Payment processing | SCCs + PCI-DSS Level 1 |
| **Sentry (Functional Software)** | USA | Error tracking (anonymised) | SCCs + SOC 2 |
| **Bitnami/VMware** | USA | Docker images (PgBouncer) | SCCs |

---

## 6. Annex 2 — Technical and Organisational Measures

| Measure | Implementation |
|---|---|
| Pseudonymisation | User display names in deal rooms are pseudonymised by default |
| Encryption in transit | TLS 1.3 enforced; HSTS preload enabled |
| Encryption at rest | AES-256 for file storage; libsodium for E2E messages |
| Access control | Role-based access tiers; MFA for Level 3 users |
| Audit logging | All admin actions logged with IP and timestamp |
| Vulnerability management | Dependency scanning; annual pen test |
| Incident response | 48-hour breach notification procedure; documented IRP |
| Backup | Daily encrypted backups to separate R2 bucket; 30-day retention |
| Data minimisation | Sensitive data (full address, commercial data) gated behind deal room NDA |

---

## 7. Contact

**Data Protection Officer:** privacy@vault.ae  
**Legal:** legal@vault.ae  
**EstateVault DMCC, Jumeirah Lakes Towers, Dubai, UAE**

---

*This DPA is incorporated by reference into the Terms of Service and is binding upon all parties.*
