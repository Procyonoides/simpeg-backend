const pool = require('../config/db');
const { calculateComponents } = require('../services/payrollService');

// Generate payroll untuk 1 periode bulan (body: { period: 'YYYY-MM' })
const generate = async (req, res) => {
  const { period } = req.body;
  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    return res.status(400).json({ message: 'Periode wajib diisi, format YYYY-MM (contoh: 2026-09)' });
  }
  const periodDate = `${period}-01`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id FROM payroll_runs WHERE company_id = $1 AND period = $2`,
      [req.user.company_id, periodDate]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Payroll untuk periode ${period} sudah pernah dibuat` });
    }

    const employees = await client.query(
      `SELECT e.id, e.full_name, e.employee_code,
        p.name as position_name, COALESCE(p.basic_salary, 0) as basic_salary,
        d.name as department_name
       FROM employees e
       LEFT JOIN employee_positions ep ON ep.employee_id = e.id AND ep.is_current = true
       LEFT JOIN positions p ON ep.position_id = p.id
       LEFT JOIN departments d ON p.department_id = d.id
       WHERE e.company_id = $1 AND e.status = 'active'`,
      [req.user.company_id]
    );

    if (employees.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Tidak ada karyawan aktif untuk digajikan' });
    }

    const components = await client.query(
      `SELECT * FROM salary_components WHERE company_id = $1`,
      [req.user.company_id]
    );

    const runResult = await client.query(
      `INSERT INTO payroll_runs (company_id, period, status, created_by)
       VALUES ($1, $2, 'draft', $3) RETURNING *`,
      [req.user.company_id, periodDate, req.user.id]
    );
    const run = runResult.rows[0];

    let totalNetAll = 0;

    for (const emp of employees.rows) {
      const basicSalary = parseFloat(emp.basic_salary) || 0;
      const calc = calculateComponents(basicSalary, components.rows);
      totalNetAll += calc.netSalary;

      const itemResult = await client.query(
        `INSERT INTO payroll_items
          (payroll_run_id, employee_id, employee_name, employee_code, position_name, department_name,
           basic_salary, total_allowance, total_deduction, gross_salary, net_salary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [run.id, emp.id, emp.full_name, emp.employee_code, emp.position_name, emp.department_name,
         basicSalary, calc.totalAllowance, calc.totalDeduction, calc.grossSalary, calc.netSalary]
      );
      const item = itemResult.rows[0];

      for (const b of calc.breakdown) {
        await client.query(
          `INSERT INTO payroll_item_components (payroll_item_id, component_name, type, amount)
           VALUES ($1, $2, $3, $4)`,
          [item.id, b.component_name, b.type, b.amount]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: `Payroll periode ${period} berhasil dibuat untuk ${employees.rows.length} karyawan`,
      payroll_run: run,
      employee_count: employees.rows.length,
      total_net: totalNetAll
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  } finally {
    client.release();
  }
};

const getAll = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pr.*,
        COUNT(pi.id) as employee_count,
        COALESCE(SUM(pi.net_salary), 0) as total_net
       FROM payroll_runs pr
       LEFT JOIN payroll_items pi ON pi.payroll_run_id = pr.id
       WHERE pr.company_id = $1
       GROUP BY pr.id
       ORDER BY pr.period DESC`,
      [req.user.company_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const getById = async (req, res) => {
  try {
    const run = await pool.query(
      `SELECT * FROM payroll_runs WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    if (run.rows.length === 0)
      return res.status(404).json({ message: 'Data payroll tidak ditemukan' });

    const items = await pool.query(
      `SELECT * FROM payroll_items WHERE payroll_run_id = $1 ORDER BY employee_name`,
      [req.params.id]
    );

    res.json({ ...run.rows[0], items: items.rows });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Slip gaji 1 karyawan (breakdown per komponen)
const getSlip = async (req, res) => {
  try {
    const item = await pool.query(
      `SELECT pi.*, pr.period, pr.company_id, pr.status as run_status
       FROM payroll_items pi
       JOIN payroll_runs pr ON pi.payroll_run_id = pr.id
       WHERE pi.id = $1`,
      [req.params.itemId]
    );
    if (item.rows.length === 0 || item.rows[0].company_id !== req.user.company_id) {
      return res.status(404).json({ message: 'Slip tidak ditemukan' });
    }

    const components = await pool.query(
      `SELECT component_name, type, amount FROM payroll_item_components WHERE payroll_item_id = $1`,
      [req.params.itemId]
    );

    res.json({ ...item.rows[0], components: components.rows });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Kunci payroll biar gak bisa di-generate ulang / kehapus gak sengaja
const finalize = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE payroll_runs SET status = 'finalized', finalized_at = NOW()
       WHERE id = $1 AND company_id = $2 AND status = 'draft' RETURNING *`,
      [req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Data tidak ditemukan atau sudah difinalisasi' });
    res.json({ message: 'Payroll berhasil difinalisasi', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Hapus payroll draft (yang sudah final tidak boleh dihapus)
const remove = async (req, res) => {
  try {
    const run = await pool.query(
      `SELECT * FROM payroll_runs WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    if (run.rows.length === 0)
      return res.status(404).json({ message: 'Data tidak ditemukan' });
    if (run.rows[0].status === 'finalized')
      return res.status(400).json({ message: 'Payroll yang sudah difinalisasi tidak bisa dihapus' });

    await pool.query(`DELETE FROM payroll_runs WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Payroll draft berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

module.exports = { generate, getAll, getById, getSlip, finalize, remove };
