// Direct database access for what the API deliberately can't do: move an approval past its expiry,
// and delete this run's users and organizations afterwards. Needs DATABASE_URL (read from .env by
// `pnpm test:e2e`); without it these steps are skipped.
import pg from "pg";

const url = process.env.DATABASE_URL;

export const hasDb = Boolean(url);

let pool: pg.Pool | undefined;

function db(): pg.Pool {
  if (!url) throw new Error("DATABASE_URL is not set");
  pool ??= new pg.Pool({ connectionString: url, max: 2 });
  return pool;
}

/** Makes the proposal's approval expire one minute ago. */
export async function forceApprovalExpiry(proposalId: string): Promise<void> {
  const r = await db().query("update approval set expires_at = now() - interval '1 minute' where proposal_id = $1", [proposalId]);
  if (r.rowCount !== 1) throw new Error(`No approval for proposal ${proposalId}`);
}

/**
 * Deletes the organizations of users whose name starts with `prefix` (their proposals, orders,
 * audit events, preferences, recipes and stock cascade), then the users. Closes the pool.
 */
export async function cleanup(prefix: string): Promise<void> {
  if (!url) return;
  const d = db();
  try {
    const owned = `select om.organization_id from organization_member om join "user" u on u.id = om.user_id
                   where left(u.username, length($1)) = $1`;
    await d.query(`delete from organization where id in (${owned})`, [prefix]);
    await d.query(`delete from "user" where left(username, length($1)) = $1`, [prefix]);
  } finally {
    await d.end();
    pool = undefined;
  }
}
