const pool = require('../config/db'); // Postgres
const { sql, getPool } = require('../config/mssql'); // SQL Server

// Ringkasan absensi harian 1 karyawan dalam rentang bulan tertentu.
// Pendekatan: waktu tercatat PALING AWAL di 1 hari = jam masuk,
// PALING AKHIR = jam pulang. Tidak mengandalkan CHECKTYPE karena
// nilainya tidak konsisten di data mesin fingerprint.
async function fetchAttendanceByCode(employeeCode, year, month) {
  const mssqlPool = await getPool();
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 1).toISOString().slice(0, 10); // awal bulan berikutnya

  const result = await mssqlPool.request()
    .input('ssn', sql.VarChar, employeeCode)
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .query(`
      SELECT
        CAST(c.CHECKTIME AS DATE) as attendance_date,
        MIN(c.CHECKTIME) as check_in,
        MAX(c.CHECKTIME) as check_out,
        COUNT(*) as scan_count
      FROM dbo.CHECKINOUT c
      JOIN dbo.USERINFO u ON c.USERID = u.USERID
      WHERE u.SSN = @ssn
        AND c.CHECKTIME >= @startDate AND c.CHECKTIME < @endDate
      GROUP BY CAST(c.CHECKTIME AS DATE)
      ORDER BY attendance_date DESC
    `);

  return result.recordset;
}

// Admin/HR: lihat absensi karyawan tertentu
const getEmployeeAttendance = async (req, res) => {
  try {
    const emp = await pool.query(
      `SELECT employee_code, full_name FROM employees WHERE id = $1 AND company_id = $2`,
      [req.params.employeeId, req.user.company_id]
    );
    if (emp.rows.length === 0) {
      return res.status(404).json({ message: 'Karyawan tidak ditemukan' });
    }
    if (!emp.rows[0].employee_code) {
      return res.status(400).json({ message: 'Karyawan ini belum punya NIK/kode karyawan' });
    }

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);

    const records = await fetchAttendanceByCode(emp.rows[0].employee_code, year, month);
    res.json({ employee_name: emp.rows[0].full_name, year, month, records });
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengambil data absensi', error: err.message });
  }
};

// Karyawan: lihat absensi sendiri
const getMyAttendance = async (req, res) => {
  try {
    const emp = await pool.query(
      `SELECT employee_code FROM employees WHERE id = $1`,
      [req.user.employee_id]
    );
    if (emp.rows.length === 0 || !emp.rows[0].employee_code) {
      return res.status(400).json({ message: 'Data karyawan tidak lengkap' });
    }

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);

    const records = await fetchAttendanceByCode(emp.rows[0].employee_code, year, month);
    res.json({ year, month, records });
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengambil data absensi', error: err.message });
  }
};

// Dipakai Dashboard: jumlah karyawan yang sudah absen hari ini
const getTodayPresentCount = async (companyId) => {
  const mssqlPool = await getPool();
  const result = await mssqlPool.request().query(`
    SELECT DISTINCT u.SSN
    FROM dbo.CHECKINOUT c
    JOIN dbo.USERINFO u ON c.USERID = u.USERID
    WHERE CAST(c.CHECKTIME AS DATE) = CAST(GETDATE() AS DATE)
  `);
  const codesToday = result.recordset.map(r => r.SSN).filter(Boolean);
  if (codesToday.length === 0) return 0;

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM employees WHERE company_id = $1 AND status = 'active' AND employee_code = ANY($2)`,
    [companyId, codesToday]
  );
  return parseInt(countResult.rows[0].count);
};

module.exports = { getEmployeeAttendance, getMyAttendance, getTodayPresentCount };