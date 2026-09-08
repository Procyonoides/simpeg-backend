const pool = require('../config/db');
const { getOrCreateCurrentBalance, countLeaveDays } = require('../services/leaveBalanceService');

const getAll = async (req, res) => {
  try {
    const { status, type } = req.query;
    let query = `
      SELECT lr.*, 
        e.full_name, e.employee_code,
        d.name as department_name,
        u.username as approved_by_name
      FROM leave_requests lr
      JOIN employees e ON lr.employee_id = e.id
      LEFT JOIN employee_positions ep ON ep.employee_id = e.id AND ep.is_current = true
      LEFT JOIN positions p ON ep.position_id = p.id
      LEFT JOIN departments d ON p.department_id = d.id
      LEFT JOIN users u ON lr.approved_by = u.id
      WHERE e.company_id = $1
    `;
    const params = [req.user.company_id];

    if (status) { params.push(status); query += ` AND lr.status = $${params.length}`; }
    if (type) { params.push(type); query += ` AND lr.type = $${params.length}`; }

    query += ` ORDER BY lr.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const getById = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT lr.*, e.full_name, e.employee_code, d.name as department_name
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.id
       LEFT JOIN employee_positions ep ON ep.employee_id = e.id AND ep.is_current = true
       LEFT JOIN positions p ON ep.position_id = p.id
       LEFT JOIN departments d ON p.department_id = d.id
       WHERE lr.id = $1 AND e.company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Data tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Sisa kuota cuti tahunan karyawan (siklus otomatis reset di sini)
const getBalance = async (req, res) => {
  try {
    const emp = await pool.query(
      `SELECT id FROM employees WHERE id = $1 AND company_id = $2`,
      [req.params.employeeId, req.user.company_id]
    );
    if (emp.rows.length === 0) {
      return res.status(404).json({ message: 'Karyawan tidak ditemukan' });
    }

    const balance = await getOrCreateCurrentBalance(req.params.employeeId);
    res.json({
      quota: balance.quota,
      used: balance.used,
      remaining: balance.quota - balance.used,
      cycle_start: balance.cycle_start,
      cycle_end: balance.cycle_end
    });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const create = async (req, res) => {
  const { employee_id, type, start_date, end_date, reason } = req.body;
  try {
    // Kuota cuma berlaku untuk cuti tahunan ('annual'); sakit/izin bebas kuota
    if (type === 'annual') {
      const balance = await getOrCreateCurrentBalance(employee_id);
      const remaining = balance.quota - balance.used;
      const requestedDays = countLeaveDays(start_date, end_date);

      if (requestedDays > remaining) {
        return res.status(400).json({
          message: `Sisa kuota cuti tahunan tidak cukup. Sisa: ${remaining} hari, diajukan: ${requestedDays} hari.`
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO leave_requests (employee_id, type, start_date, end_date, reason, status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
      [employee_id, type, start_date, end_date, reason]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const approve = async (req, res) => {
  const { status } = req.body; // 'approved' | 'rejected'
  try {
    const existing = await pool.query(`SELECT * FROM leave_requests WHERE id = $1`, [req.params.id]);
    if (existing.rows.length === 0)
      return res.status(404).json({ message: 'Data tidak ditemukan' });
    const leaveReq = existing.rows[0];

    const result = await pool.query(
      `UPDATE leave_requests 
       SET status = $1, approved_by = $2, approved_at = NOW(), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, req.user.id, req.params.id]
    );

    // Potong kuota HANYA saat disetujui, dan hanya sekali (jaga-jaga endpoint dipanggil ulang)
    if (status === 'approved' && leaveReq.status !== 'approved' && leaveReq.type === 'annual') {
      const balance = await getOrCreateCurrentBalance(leaveReq.employee_id);
      const days = countLeaveDays(leaveReq.start_date, leaveReq.end_date);
      await pool.query(
        `UPDATE leave_balances SET used = used + $1 WHERE id = $2`,
        [days, balance.id]
      );
    }

    res.json({ message: `Pengajuan berhasil ${status === 'approved' ? 'disetujui' : 'ditolak'}`, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const remove = async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM leave_requests WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Data tidak ditemukan' });
    res.json({ message: 'Pengajuan berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

module.exports = { getAll, getById, getBalance, create, approve, remove };
