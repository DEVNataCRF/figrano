// Cria as tabelas no banco de DATABASE_URL. Pode rodar mais de uma vez.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Defina DATABASE_URL.');
  process.exit(1);
}
const sql = postgres(url, { max: 1 });
await sql.unsafe(readFileSync(new URL('../lib/schema.sql', import.meta.url), 'utf8'));
await sql.end();
console.log('Tabelas prontas.');
