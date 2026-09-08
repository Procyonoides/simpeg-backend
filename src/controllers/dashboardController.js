const pool = require('../config/db');

const getStats = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    // Total karyawan aktif
    const totalEmployees = await pool.query(
      `SELECT COUNT(*) FROM employees WHERE company_id = $1 AND status = 'active'`,
      [companyId]
    );

    // Karyawan baru bulan ini (berdasarkan join_date)
    const newThisMonth = await pool.query(
      `SELECT COUNT(*) FROM employees
       WHERE company_id = $1 AND status = 'active'
       AND date_trunc('month', join_date) = date_trunc('month', CURRENT_DATE)`,
      [companyId]
    );

    // Pengajuan cuti yang masih pending
    const pendingLeave = await pool.query(
      `SELECT COUNT(*) FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.id
       WHERE e.company_id = $1 AND lr.status = 'pending'`,
      [companyId]
    );

    // Karyawan per departemen
    const byDepartment = await pool.query(
      `SELECT d.name AS department_name, COUNT(e.id) AS total
       FROM employees e
       JOIN employee_positions ep ON ep.employee_id = e.id AND ep.is_current = true
       JOIN positions p ON ep.position_id = p.id
       JOIN departments d ON p.department_id = d.id
       WHERE e.company_id = $1 AND e.status = 'active'
       GROUP BY d.name
       ORDER BY total DESC`,
      [companyId]
    );

    // 5 pengajuan cuti terbaru
    const recentLeave = await pool.query(
      `SELECT lr.id, lr.type, lr.start_date, lr.end_date, lr.status,
        e.full_name
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.id
       WHERE e.company_id = $1
       ORDER BY lr.created_at DESC
       LIMIT 5`,
      [companyId]
    );

    res.json({
      total_employees: parseInt(totalEmployees.rows[0].count),
      new_this_month: parseInt(newThisMonth.rows[0].count),
      pending_leave: parseInt(pendingLeave.rows[0].count),
      department_breakdown: byDepartment.rows,
      recent_leave: recentLeave.rows,
      // Belum ada modul absensi & payroll, jadi field ini sengaja tidak dikirim
      // sampai kedua modul itu dibuat.
    });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

module.exports = { getStats };
