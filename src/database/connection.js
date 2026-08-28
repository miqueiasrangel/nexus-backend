const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 10000, // 10 segundos de timeout de conexão
  idleTimeoutMillis: 30000,
  keepAlive: true
});

pool.on('error', (err) => {
  console.error('Erro inesperado no Pool do PostgreSQL:', err.message);
});

module.exports = pool;
