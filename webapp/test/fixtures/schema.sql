-- Copy of bank-sim/schema.sql for the webapp test database.
-- Keep in sync with bank-sim if the core schema changes.
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
  payload JSONB NOT NULL,
  signed_at TIMESTAMPTZ DEFAULT now()
);
