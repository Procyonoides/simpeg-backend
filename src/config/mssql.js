const sql = require('mssql');

const config = {
  server: process.env.MSSQL_SERVER,
  database: process.env.MSSQL_DATABASE,
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  options: {
    encrypt: true,
    trustServerCertificate: true // perlu buat instance lokal/self-signed cert kayak SQLEXPRESS
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let poolPromise;

// Reuse 1 connection pool untuk semua query, jangan bikin koneksi baru tiap request
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect().catch(err => {
      poolPromise = null; // biar bisa dicoba konek ulang kalau gagal
      throw err;
    });
  }
  return poolPromise;
}

module.exports = { sql, getPool };