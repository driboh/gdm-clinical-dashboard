import { Pool, type PoolClient } from "pg";

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const globalForClinical = globalThis as unknown as { gdmClinicalPool?: Pool };

export function clinicalPool() {
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  if (!globalForClinical.gdmClinicalPool) globalForClinical.gdmClinicalPool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
  return globalForClinical.gdmClinicalPool;
}

export async function withClinicalTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await clinicalPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
