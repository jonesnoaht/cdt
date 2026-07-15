# Mapping HttpIdentusAgent to a live Identus / PRISM agent

**Status:** Integration guide (client is production-shaped; path mapping is org-specific)  
**Code:** `credentials/src/identus.ts` · `createIdentusAgentFromEnv`  
**Related:** [production-readiness.md](../production-readiness.md) · [key-ceremony.md](./key-ceremony.md)

## Default façade (CDT thin agent)

| Operation | Method | Default path |
| --- | --- | --- |
| Health | `GET` | `/health` |
| Verify presentation | `POST` | `/v1/presentations/verify` |
| Issue account-holder VC | `POST` | `/v1/credentials/account-holder` |

### Request / response shapes

**Verify**

```json
// POST body
{
  "presentation": { /* W3C VP */ },
  "challenge": "nonce…",
  "trustedRoots": ["did:prism:…"],
  "now": "2026-07-15T00:00:00.000Z"
}
// 200
{ "ok": true }
// or
{ "verified": true }
// reject
{ "ok": false, "reason": "…" }
```

**Issue account-holder**

```json
// POST body
{
  "memberDid": "did:…",
  "claims": { "accountStanding": "good" },
  "expiresInMs": 31536000000
}
// 200
{ "credential": { /* W3C VC */ } }
// or
{ "data": { "credential": { /* W3C VC */ } } }
```

**Health**

```json
{ "ready": true }
// also accepted: { "status": "UP" } | { "status": "ok" }
```

## Env mapping for your org agent

```bash
export IDENTUS_MODE=http
export IDENTUS_BASE_URL=https://identus.your-cu.internal
export IDENTUS_API_TOKEN=…                 # optional Bearer
export IDENTUS_TRUSTED_ROOTS=did:prism:ncuaRoot,…

# Path overrides when your agent differs from the CDT façade:
export IDENTUS_PATH_HEALTH=/actuator/health
export IDENTUS_PATH_VERIFY=/cloud-agent/present-proof/definitions/verify
export IDENTUS_PATH_ISSUE_ACCOUNT=/cloud-agent/credential-definition/issue

# mTLS (optional, shared with ACH/IDV clients)
export CDT_TLS_CERT_FILE=/etc/cdt/client.crt
export CDT_TLS_KEY_FILE=/etc/cdt/client.key
export CDT_TLS_CA_FILE=/etc/cdt/ca.crt
```

## Adapter pattern (recommended)

If your Identus cloud API is richer than the thin façade, run a **small reverse adapter** in your VPC:

```text
CDT services  ──HTTPS/mTLS──►  adapter  ──►  Identus cloud / agent
                              (maps paths + schemas)
```

Do **not** put cloud admin keys on the oracle host. Adapter holds Identus credentials; CDT only sees the façade.

## Wallet-held presentations (target state)

Today oracle `CDT_VC_MODE=credentials` enrolls from bank DB keys (server-side stand-in). Production:

1. Member wallet holds AccountHolderCredential.  
2. Oracle issues a one-time challenge.  
3. Wallet returns VP → `HttpIdentusAgent.verifyPresentation`.  
4. On success, oracle signs mint attestation.

The HTTP verify endpoint is the gate; enrollment APIs are for **issuer desk onboarding**, not mint-time.

## Checklist before pilot mint

- [ ] `IDENTUS_MODE=http` + health returns ready under prod-env checker  
- [ ] Verify rejects bad challenge / wrong root  
- [ ] Issue path only reachable from issuer desk network  
- [ ] mTLS or private network between CDT and agent  
- [ ] Trusted roots pinned offline (ceremony log)  
