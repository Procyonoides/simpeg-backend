const pool = require('../config/db');

// Daftar semua pengajuan perubahan data (default: yang pending dulu)
const getAll = async (req, res) => {
  try {
    const status = req.query.status; // optional filter: pending | approved | rejected
    const params = [req.user.company_id];
    let where = `WHERE e.company_id = $1`;
    if (status) {
      params.push(status);
      where += ` AND r.status = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT r.*, e.full_name as employee_name, e.employee_code
       FROM employee_profile_change_requests r
       JOIN employees e ON r.employee_id = e.id
       ${where}
       ORDER BY r.requested_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Setujui pengajuan — nilai baru langsung diterapkan ke tabel employees
const approve = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reqResult = await client.query(
      `SELECT r.*, e.company_id
       FROM employee_profile_change_requests r
       JOIN employees e ON r.employee_id = e.id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (reqResult.rows.length === 0 || reqResult.rows[0].company_id !== req.user.company_id) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Pengajuan tidak ditemukan' });
    }
    const changeReq = reqResult.rows[0];
    if (changeReq.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Pengajuan ini sudah diproses sebelumnya' });
    }

    // field_name divalidasi dari whitelist saat pengajuan dibuat (portalController),
    // jadi aman dipakai langsung sebagai nama kolom di sini
    await client.query(
      `UPDATE employees SET ${changeReq.field_name} = $1 WHERE id = $2`,
      [changeReq.new_value, changeReq.employee_id]
    );
    await client.query(
      `UPDATE employee_profile_change_requests
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2`,
      [req.user.id, req.params.id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Pengajuan disetujui, data karyawan sudah diperbarui' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  } finally {
    client.release();
  }
};

const reject = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE employee_profile_change_requests r
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW()
       FROM employees e
       WHERE r.id = $2 AND r.employee_id = e.id AND e.company_id = $3 AND r.status = 'pending'
       RETURNING r.id`,
      [req.user.id, req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pengajuan tidak ditemukan atau sudah diproses' });
    }
    res.json({ message: 'Pengajuan ditolak' });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

module.exports = { getAll, approve, reject };
