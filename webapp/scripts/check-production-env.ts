/**
 * Production environment gate checker.
 *
 * Usage:
 *   cd webapp && npm run check:prod-env
 *   NODE_ENV=production CDT_API_KEY=… PGPASSWORD=… npm run check:prod-env
 *
 * Exit 0 if ready for a pilot (not a formal certification).
 * Exit 1 if any hard fail-closed gate is open.
 */
const env = process.env;

type Severity = "error" | "warn" | "ok";

interface Finding {
  severity: Severity;
  code: string;
  message: string;
}

const findings: Finding[] = [];

function err(code: string, message: string): void {
  findings.push({ severity: "error", code, message });
}
function warn(code: string, message: string): void {
  findings.push({ severity: "warn", code, message });
}
function ok(code: string, message: string): void {
  findings.push({ severity: "ok", code, message });
}

const isProd = env.NODE_ENV === "production";

if (isProd) {
  if (!env.PGPASSWORD) err("PGPASSWORD", "Required when NODE_ENV=production");
  else ok("PGPASSWORD", "set");

  if (!env.CDT_API_KEY && !(env.CDT_ISSUER_API_KEY && env.CDT_CORRESPONDENT_API_KEY) && !env.CDT_JWT_SECRET) {
    err(
      "AUTH",
      "Set CDT_API_KEY and/or dual keys and/or CDT_JWT_SECRET (fail-closed API auth)",
    );
  } else {
    ok("AUTH", "at least one auth mechanism configured");
  }

  if (env.CDT_ALLOW_OPEN_API === "1") {
    err("CDT_ALLOW_OPEN_API", "Must not be 1 in production");
  } else {
    ok("CDT_ALLOW_OPEN_API", "not open-lab");
  }

  if (env.CDT_ORACLE_ACCEPT_ALL_VC === "1") {
    err("CDT_ORACLE_ACCEPT_ALL_VC", "Must not accept-all VCs in production");
  } else {
    ok("CDT_ORACLE_ACCEPT_ALL_VC", "not accept-all");
  }

  if (env.ALLOW_EPHEMERAL_ORACLE_KEY === "1") {
    err("ALLOW_EPHEMERAL_ORACLE_KEY", "Use ORACLE_SIGNING_KEY_PEM in production");
  }
  if (env.ALLOW_EPHEMERAL_PAYMENT_ORACLE === "1") {
    warn("ALLOW_EPHEMERAL_PAYMENT_ORACLE", "Prefer PAYMENT_ORACLE_SIGNING_KEY_PEM");
  }

  if (!env.ORACLE_SIGNING_KEY_PEM && env.ALLOW_EPHEMERAL_ORACLE_KEY !== "1") {
    warn("ORACLE_SIGNING_KEY_PEM", "Not set (oracle CLI will refuse without lab flag)");
  }

  if (env.HOST && env.HOST !== "127.0.0.1" && env.HOST !== "localhost") {
    warn("HOST", `Bound is ${env.HOST} — prefer 127.0.0.1 behind reverse proxy/mTLS`);
  } else {
    ok("HOST", env.HOST || "default 127.0.0.1");
  }

  if (env.CDT_VC_MODE === "accept_all") {
    err("CDT_VC_MODE", "accept_all is lab-only");
  } else if (env.CDT_VC_MODE === "credentials") {
    ok("CDT_VC_MODE", "credentials");
  } else {
    warn("CDT_VC_MODE", "default fail_closed — ensure credentials mode for pilot mint");
  }

  if (env.SETTLEMENT_RAIL === "http" || env.SETTLEMENT_RAIL === "ach") {
    if (!env.SETTLEMENT_ACH_URL) {
      err("SETTLEMENT_ACH_URL", "Required when SETTLEMENT_RAIL=http");
    } else {
      ok("SETTLEMENT_RAIL", "http adapter configured");
    }
  } else if (env.SETTLEMENT_RAIL === "none" || env.SETTLEMENT_RAIL === "disabled") {
    warn("SETTLEMENT_RAIL", "disabled — SettlementPayment will refuse");
  } else if (!env.SETTLEMENT_RAIL || env.SETTLEMENT_RAIL === "mock") {
    warn("SETTLEMENT_RAIL", "mock ACH only — not a real payment rail");
  }

  if (env.CDT_IDV_MODE === "http" && !env.CDT_IDV_URL) {
    err("CDT_IDV_URL", "Required when CDT_IDV_MODE=http");
  } else if (env.CDT_IDV_MODE === "http") {
    ok("CDT_IDV_MODE", "http provider");
  } else if (env.CDT_IDV_REQUIRE === "1" && (env.CDT_IDV_MODE || "mock") === "mock") {
    warn("CDT_IDV_REQUIRE", "enforced with mock IDV — wire CDT_IDV_MODE=http for production CIP");
  }

  if (env.IDENTUS_MODE === "http" && !env.IDENTUS_BASE_URL) {
    err("IDENTUS_BASE_URL", "Required when IDENTUS_MODE=http");
  } else if (env.IDENTUS_MODE === "http") {
    ok("IDENTUS_MODE", "http");
  } else {
    warn("IDENTUS_MODE", env.IDENTUS_MODE || "mock — map HttpIdentusAgent to live agent for production");
  }

  if (env.BURN_VALIDATE_MODE === "off") {
    warn("BURN_VALIDATE_MODE", "off — prefer soft/strict with CHAIN_PROVIDER=koios-preview");
  }

  if (env.CDT_JWT_SECRET && env.CDT_JWT_SECRET.length < 32) {
    warn("CDT_JWT_SECRET", "use ≥32 random bytes in production");
  } else if (env.CDT_JWT_SECRET) {
    ok("CDT_JWT_SECRET", "set");
  }
} else {
  ok("NODE_ENV", `${env.NODE_ENV || "development"} — production gates skipped (set NODE_ENV=production to enforce)`);
}

let errors = 0;
let warns = 0;
for (const f of findings) {
  const tag = f.severity.toUpperCase().padEnd(5);
  console.log(`${tag}  [${f.code}] ${f.message}`);
  if (f.severity === "error") errors += 1;
  if (f.severity === "warn") warns += 1;
}

console.log("");
if (errors > 0) {
  console.log(`FAIL  ${errors} error(s), ${warns} warning(s) — not production-ready`);
  process.exit(1);
}
console.log(`PASS  0 errors, ${warns} warning(s) — pilot gates clear (still not a formal certification)`);
process.exit(0);
