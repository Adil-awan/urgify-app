const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL_IPV4 || process.env.DATABASE_URL;
let normalizedConnectionString = connectionString;

if (connectionString) {
  try {
    const parsed = new URL(connectionString);
    parsed.searchParams.delete('sslmode');
    normalizedConnectionString = parsed.toString();
  } catch {
    normalizedConnectionString = connectionString;
  }
}
const pool = new Pool({
  connectionString: normalizedConnectionString,
  ssl: connectionString && connectionString.includes('supabase.com')
    ? { rejectUnauthorized: false }
    : undefined,
});

async function test() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Database connected:', res.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error('❌ Database connection failed:', err);
    process.exit(1);
  }
}

test();
