-- Simulated credit-union core-banking schema for the CDT project.
-- Applied automatically on first container start via /docker-entrypoint-initdb.d,
-- or manually with `npm run db:apply`.

CREATE TABLE IF NOT EXISTS cd_products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  term_months INT NOT NULL,
  rate_bps INT NOT NULL,
  penalty_bps INT NOT NULL,
  min_deposit_cents BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  member_name TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  did TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('checking', 'cd_funding')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  account_id INT REFERENCES accounts NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  product_id INT REFERENCES cd_products NULL,
  memo TEXT,
  attested BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- FK joins (getBalances, listUnattestedCdDeposits).
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions (account_id);

-- The oracle watcher's hot polling query: unattested CD-funding deposits.
CREATE INDEX IF NOT EXISTS idx_transactions_unattested_cd
  ON transactions (id)
  WHERE attested = false AND product_id IS NOT NULL AND kind = 'deposit';

CREATE TABLE IF NOT EXISTS attestations (
  id SERIAL PRIMARY KEY,
  transaction_id INT UNIQUE REFERENCES transactions NOT NULL,
  deposit_id TEXT NOT NULL,
  -- Bank account id bound into the oracle attestation (string form of accounts.id).
  account_id TEXT NOT NULL DEFAULT '',
  -- Hex SHA-256 of the canonical attestation payload (vault datum attestation_hash).
  attestation_hash TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL,
  signed_at TIMESTAMPTZ DEFAULT now()
);

-- One deposit_id may never receive two attestations (issuance uniqueness).
CREATE UNIQUE INDEX IF NOT EXISTS idx_attestations_deposit_id_unique
  ON attestations (deposit_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attestations_hash_unique
  ON attestations (attestation_hash)
  WHERE attestation_hash <> '';

-- Upgrade path for volumes created before account-bound attestations.
ALTER TABLE attestations ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE attestations ADD COLUMN IF NOT EXISTS attestation_hash TEXT NOT NULL DEFAULT '';

-- Durable correspondent presentments (SettlementAuth / BurnEvidence pipeline).
CREATE TABLE IF NOT EXISTS presentments (
  id SERIAL PRIMARY KEY,
  deposit_id TEXT NOT NULL,
  transaction_id INT REFERENCES transactions,
  status TEXT NOT NULL,
  presenting_cu_name TEXT NOT NULL,
  issuer_name TEXT NOT NULL,
  walk_in_name TEXT NOT NULL,
  principal_cents BIGINT NOT NULL,
  cash_out_cents BIGINT NOT NULL,
  cash_out_mode TEXT NOT NULL,
  product_name TEXT NOT NULL,
  rate_bps INT NOT NULL,
  holder_did TEXT NOT NULL,
  holder_wallet TEXT NOT NULL,
  settlement TEXT NOT NULL DEFAULT '',
  next_steps JSONB NOT NULL DEFAULT '[]',
  settlement_instructions TEXT,
  settlement_auth JSONB,
  burn_tx_hash TEXT,
  burn_mode TEXT,
  settlement_payment JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_presentments_burn_tx
  ON presentments (burn_tx_hash)
  WHERE burn_tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_presentments_deposit ON presentments (deposit_id);
CREATE INDEX IF NOT EXISTS idx_presentments_status ON presentments (status);

-- Append-only audit trail for presentment state transitions (settlement network).
CREATE TABLE IF NOT EXISTS presentment_events (
  id BIGSERIAL PRIMARY KEY,
  presentment_id INT NOT NULL REFERENCES presentments (id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_presentment_events_presentment
  ON presentment_events (presentment_id, id);

-- Network-wide one-shot registry for deposit lifecycle (off-chain until on-chain registry exists).
-- States: attested → minted → burned (terminal). Prevents double-mint / double-burn at the issuer DB.
CREATE TABLE IF NOT EXISTS deposit_registry (
  deposit_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT '',
  attestation_hash TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('attested', 'minted', 'burned')),
  mint_tx_hash TEXT,
  burn_tx_hash TEXT,
  presentment_id INT REFERENCES presentments (id),
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposit_registry_mint_tx
  ON deposit_registry (mint_tx_hash)
  WHERE mint_tx_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposit_registry_burn_tx
  ON deposit_registry (burn_tx_hash)
  WHERE burn_tx_hash IS NOT NULL;

-- Idempotent settlement payments (client Idempotency-Key).
ALTER TABLE presentments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_presentments_idempotency
  ON presentments (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

-- Credit-claim product: CD + secured LOC + CDT claim units (see design 2026-07-16).
CREATE TABLE IF NOT EXISTS certificates (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id),
  product_id INT NOT NULL REFERENCES cd_products(id),
  principal_cents BIGINT NOT NULL CHECK (principal_cents > 0),
  rate_bps INT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  maturity_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'pledged', 'matured', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_facilities (
  id SERIAL PRIMARY KEY,
  certificate_id INT NOT NULL UNIQUE REFERENCES certificates(id),
  borrower_account_id INT NOT NULL REFERENCES accounts(id),
  series_id TEXT NOT NULL UNIQUE,
  limit_cents BIGINT NOT NULL CHECK (limit_cents > 0),
  drawn_cents BIGINT NOT NULL DEFAULT 0 CHECK (drawn_cents >= 0),
  holds_cents BIGINT NOT NULL DEFAULT 0 CHECK (holds_cents >= 0),
  rate_bps INT NOT NULL,
  ltv_bps INT NOT NULL CHECK (ltv_bps > 0 AND ltv_bps <= 10000),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'active', 'maturing', 'default', 'closed'
  )),
  maturity_at TIMESTAMPTZ NOT NULL,
  on_chain_supply_cents BIGINT NOT NULL DEFAULT 0 CHECK (on_chain_supply_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (drawn_cents + holds_cents <= limit_cents)
);

CREATE INDEX IF NOT EXISTS idx_credit_facilities_status
  ON credit_facilities (status);
CREATE INDEX IF NOT EXISTS idx_credit_facilities_borrower
  ON credit_facilities (borrower_account_id);

CREATE TABLE IF NOT EXISTS facility_presentments (
  id SERIAL PRIMARY KEY,
  facility_id INT NOT NULL REFERENCES credit_facilities(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  presenter_wallet TEXT NOT NULL,
  presenter_name TEXT NOT NULL DEFAULT '',
  cip_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN (
    'requested', 'drawn', 'paid', 'burned', 'failed', 'reconciled'
  )),
  draw_note TEXT,
  payout_note TEXT,
  burn_tx_hash TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_presentments_facility
  ON facility_presentments (facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_presentments_status
  ON facility_presentments (status);

CREATE TABLE IF NOT EXISTS facility_events (
  id SERIAL PRIMARY KEY,
  facility_id INT NOT NULL REFERENCES credit_facilities(id),
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_events_facility
  ON facility_events (facility_id);

