const pool = require('../config/db');

const DEFAULT_QUOTA = 12;

// Hitung tanggal mulai siklus cuti AKTIF (berdasarkan ulang tahun join_date).
// Contoh: join_date = 2020-03-15, hari ini 2026-05-01
//   -> ulang tahun tahun ini (2026-03-15) sudah lewat -> cycle_start = 2026-03-15
// Kalau hari ini 2026-02-01 (belum lewat ulang tahun tahun ini)
//   -> cycle_start = 2025-03-15 (siklus tahun lalu masih berjalan)
function getCurrentCycleStart(joinDate, today = new Date()) {
  const join = new Date(joinDate);
  const anniversaryThisYear = new Date(today.getFullYear(), join.getMonth(), join.getDate());

  if (anniversaryThisYear <= today) {
    return anniversaryThisYear;
  }
  return new Date(today.getFullYear() - 1, join.getMonth(), join.getDate());
}

function cycleEndFromStart(cycleStart) {
  const d = new Date(cycleStart);
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1); // sehari sebelum ulang tahun berikutnya
  return d;
}

function toDateStr(d) {
  return new Date(d).toISOString().split('T')[0];
}

// Ambil saldo cuti aktif karyawan untuk siklus SEKARANG.
// Kalau siklus sudah berganti (lewat ulang tahun join_date) dan belum ada
// record untuk siklus itu, dibuatkan baru quota=12/used=0 -- sisa cuti
// dari siklus sebelumnya TIDAK di-carry over (hangus), sesuai aturan.
async function getOrCreateCurrentBalance(employeeId) {
  const empResult = await pool.query(
    `SELECT join_date FROM employees WHERE id = $1`,
    [employeeId]
  );
  if (empResult.rows.length === 0) {
    throw new Error('Karyawan tidak ditemukan');
  }

  const joinDate = empResult.rows[0].join_date;
  const cycleStart = getCurrentCycleStart(joinDate);
  const cycleEnd = cycleEndFromStart(cycleStart);
  const cycleStartStr = toDateStr(cycleStart);
  const cycleEndStr = toDateStr(cycleEnd);

  const existing = await pool.query(
    `SELECT * FROM leave_balances WHERE employee_id = $1 AND cycle_start = $2`,
    [employeeId, cycleStartStr]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const inserted = await pool.query(
    `INSERT INTO leave_balances (employee_id, cycle_start, cycle_end, quota, used)
     VALUES ($1, $2, $3, $4, 0)
     RETURNING *`,
    [employeeId, cycleStartStr, cycleEndStr, DEFAULT_QUOTA]
  );
  return inserted.rows[0];
}

// Jumlah hari cuti (inklusif tanggal awal & akhir)
function countLeaveDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end.getTime() - start.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

module.exports = { getOrCreateCurrentBalance, countLeaveDays, DEFAULT_QUOTA };
