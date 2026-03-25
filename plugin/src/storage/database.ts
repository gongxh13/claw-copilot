import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "@vscode/sqlite3";

import { SCHEMA_SQL } from "./schema.js";

export function openDatabase(rootDir: string): Database.Database {
  mkdirSync(rootDir, { recursive: true });
  const filePath = path.join(rootDir, "claw-copilot.db");
  const db = new Database(filePath);
  db.exec(SCHEMA_SQL);
  try {
    db.exec("ALTER TABLE agents ADD COLUMN linked_session_id TEXT");
  } catch {
    // column already exists
  }
  try {
    db.exec("ALTER TABLE agents ADD COLUMN triggered_run_id TEXT");
  } catch {
    // column already exists
  }
  return db;
}
