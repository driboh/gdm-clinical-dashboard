import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const connection = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connection) throw new Error("Set DATABASE_URL before running the portal migration.");
const migration = await readFile(new URL("../db/migrations/0001_patient_portal.sql", import.meta.url), "utf8");
const sql = neon(connection);
await sql.query(migration, []);
console.log("Patient portal database migration completed.");
