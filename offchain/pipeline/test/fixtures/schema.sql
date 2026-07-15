-- Vendored bank schema for pipeline e2e tests. Keep aligned with bank-sim/schema.sql.
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

CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions (account_id);

CREATE INDEX IF NOT EXISTS idx_transactions_unattested_cd
  ON transactions (id)
  WHERE attested = false AND product_id IS NOT NULL AND kind = 'deposit';

CREATE TABLE IF NOT EXISTS attestations (
  id SERIAL PRIMARY KEY,
  transaction_id INT UNIQUE REFERENCES transactions NOT NULL,
  deposit_id TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT '',
  attestation_hash TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL,
  signed_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attestations_deposit_id_unique
  ON attestations (deposit_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attestations_hash_unique
  ON attestations (attestation_hash)
  WHERE attestation_hash <> '';

-- Durable correspondent presentments (production path; webapp also uses this).
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (burn_tx_hash)
);

CREATE INDEX IF NOT EXISTS idx_presentments_deposit ON presentments (deposit_id);
CREATE INDEX IF NOT EXISTS idx_presentments_status ON presentments (status);

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
