const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const ALLOWED_ROLES = ['admin', 'hr', 'staff', 'employee'];
const DEFAULT_EMPLOYEE_PASSWORD = 'hsk';

// List akun staff kantor (admin/hr/staff) — akun karyawan (employee_id terisi)
// SENGAJA gak ikut ditampilkan di sini karena jumlahnya bisa ribuan;
// dikelola lewat halaman Karyawan (reset password per orang / bulk create).
const getAll = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, role, is_active, created_at
       FROM users WHERE company_id = $1 AND employee_id IS NULL
       ORDER BY username`,
      [req.user.company_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Tambah user baru (hr/staff/admin) untuk perusahaan yang sama (admin only)
const create = async (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ message: 'Username, password, dan role wajib diisi' });
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ message: `Role tidak valid. Pilihan: ${ALLOWED_ROLES.join(', ')}` });
  }

  try {
    const existing = await pool.query(`SELECT id FROM users WHERE username = $1`, [username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'Username sudah dipakai' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (company_id, username, password, role, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, true, true)
       RETURNING id, username, role, is_active, created_at`,
      [req.user.company_id, username, hashedPassword, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Ubah role atau status aktif user (admin only)
const update = async (req, res) => {
  const { role, is_active } = req.body;

  if (role && !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ message: `Role tidak valid. Pilihan: ${ALLOWED_ROLES.join(', ')}` });
  }
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ message: 'Tidak bisa mengubah role/status akun sendiri' });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET
        role = COALESCE($1, role),
        is_active = COALESCE($2, is_active)
       WHERE id = $3 AND company_id = $4
       RETURNING id, username, role, is_active`,
      [role, is_active, req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Hapus user (admin only) — tidak bisa hapus diri sendiri
const remove = async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ message: 'Tidak bisa menghapus akun sendiri' });
  }
  try {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 AND company_id = $2 RETURNING id`,
      [req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User tidak ditemukan' });
    res.json({ message: 'User berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Buatkan akun login untuk SEMUA karyawan aktif yang belum punya akun.
// Username = employee_code (NIK internal), password default = 'hsk',
// wajib ganti password di login pertama. (admin only)
const bulkCreateEmployeeAccounts = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const employees = await client.query(
      `SELECT e.id, e.employee_code
       FROM employees e
       LEFT JOIN users u ON u.employee_id = e.id
       WHERE e.company_id = $1 AND e.status = 'active' AND u.id IS NULL`,
      [req.user.company_id]
    );

    if (employees.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ message: 'Semua karyawan aktif sudah punya akun login', created_count: 0 });
    }

    const hashedDefault = await bcrypt.hash(DEFAULT_EMPLOYEE_PASSWORD, 10);
    let created = 0;
    let skipped = 0;
    const skippedCodes = [];

    for (const emp of employees.rows) {
      if (!emp.employee_code) {
        skipped++;
        continue;
      }
      // Jaga-jaga kalau ada username bentrok (harusnya jarang, karena employee_code unik)
      const existing = await client.query(`SELECT id FROM users WHERE username = $1`, [emp.employee_code]);
      if (existing.rows.length > 0) {
        skipped++;
        skippedCodes.push(emp.employee_code);
        continue;
      }

      await client.query(
        `INSERT INTO users (company_id, username, password, role, is_active, must_change_password, employee_id)
         VALUES ($1, $2, $3, 'employee', true, true, $4)`,
        [req.user.company_id, emp.employee_code, hashedDefault, emp.id]
      );
      created++;
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: `${created} akun karyawan berhasil dibuat` + (skipped > 0 ? `, ${skipped} dilewati (bentrok/tidak ada NIK)` : ''),
      created_count: created,
      skipped_count: skipped,
      skipped_codes: skippedCodes
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  } finally {
    client.release();
  }
};

// Reset password akun karyawan tertentu kembali ke default (admin only)
const resetEmployeePassword = async (req, res) => {
  try {
    const hashedDefault = await bcrypt.hash(DEFAULT_EMPLOYEE_PASSWORD, 10);
    const result = await pool.query(
      `UPDATE users SET password = $1, must_change_password = true
       WHERE employee_id = $2 AND company_id = $3
       RETURNING id, username`,
      [hashedDefault, req.params.employeeId, req.user.company_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Akun karyawan ini tidak ditemukan' });
    }
    res.json({ message: `Password berhasil direset ke default untuk ${result.rows[0].username}` });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

module.exports = { getAll, create, update, remove, bulkCreateEmployeeAccounts, resetEmployeePassword };
