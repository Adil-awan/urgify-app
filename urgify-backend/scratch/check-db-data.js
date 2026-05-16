const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_IPV4 || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log('Tables:', res.rows.map(r => r.table_name));
    
    const users = await pool.query("SELECT count(*) FROM \"User\"");
    console.log('User count:', users.rows[0].count);
    
    process.exit(0);
  } catch (err) {
    console.error('Check failed:', err);
    process.exit(1);
  }
}

check();
