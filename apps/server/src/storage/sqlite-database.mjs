import { DatabaseSync } from "node:sqlite";

export function openSqliteDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  return db;
}
