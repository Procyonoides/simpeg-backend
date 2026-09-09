const pool = require('../config/db');
const { calculateBpjs, calculatePph21, getWorkingDays } = require('../services/payrollService');

// Generate payroll untuk 1 periode (body: { year, month })
const generate = async (req, res) => {
  const { year, month } = req.body;
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ message: 'Tahun dan bulan wajib diisi dengan benar' });
  }
  const periodDate = `${year}-${String(month).padStart(2, '0')}-01`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id FROM payroll_periods WHERE company_id = $1 AND year = $2 AND month = $3`,
      [req.user.company_id, year, month]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Payroll untuk periode ${month}/${year} sudah pernah dibuat` });
    }

    // Cuma karyawan aktif YANG PUNYA jabatan aktif yang bisa digaji
    const employees = await client.query(
      `SELECT e.id, e.tax_status, p.basic_salary
       FROM employees e
       JOIN employee_positions ep ON ep.employee_id = e.id AND ep.is_current = true
       JOIN positions p ON ep.position_id = p.id
       WHERE e.company_id = $1 AND e.status = 'active'`,
      [req.user.company_id]
    );

    const activeTotal = await client.query(
      `SELECT COUNT(*) FROM employees WHERE company_id = $1 AND status = 'active'`,
      [req.user.company_id]
    );
    const skipped = parseInt(activeTotal.rows[0].count) - employees.rows.length;

    if (employees.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Tidak ada karyawan aktif yang punya jabatan aktif (employee_positions). Lengkapi jabatan karyawan dulu sebelum generate payroll.'
      });
    }

    // Konfigurasi BPJS yang berlaku pada periode ini (paling baru, <= tanggal periode)
    const bpjsConfigResult = await client.query(
      `SELECT * FROM bpjs_config WHERE company_id = $1 AND effective_date <= $2
       ORDER BY effective_date DESC LIMIT 1`,
      [req.user.company_id, periodDate]
    );
    const bpjsConfig = bpjsConfigResult.rows[0] || null;

    // Lapisan tarif PPh 21 untuk tahun ini
    const bracketsResult = await client.query(
      `SELECT * FROM pph21_config WHERE year = $1 ORDER BY pkp_from ASC`,
      [year]
    );
    if (bracketsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Tabel pph21_config belum diisi untuk tahun ${year}. Isi dulu lapisan tarif PPh 21 sebelum generate payroll.`
      });
    }

    // PTKP untuk tahun ini
    const ptkpResult = await client.query(
      `SELECT status, amount FROM ptkp_config WHERE year = $1`,
      [year]
    );
    if (ptkpResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Tabel ptkp_config belum diisi untuk tahun ${year}. Isi dulu nilai PTKP per status sebelum generate payroll.`
      });
    }
    const ptkpMap = {};
    for (const row of ptkpResult.rows) ptkpMap[row.status] = parseFloat(row.amount);

    const workingDays = getWorkingDays(year, month);

    const periodResult = await client.query(
      `INSERT INTO payroll_periods (company_id, year, month, status, processed_at)
       VALUES ($1, $2, $3, 'draft', NOW()) RETURNING *`,
      [req.user.company_id, year, month]
    );
    const period = periodResult.rows[0];

    let totalNetAll = 0;

    for (const emp of employees.rows) {
      const basicSalary = parseFloat(emp.basic_salary) || 0;

      // Komponen gaji spesifik karyawan ini (ambil versi paling baru per komponen, <= periode)
      const componentsResult = await client.query(
        `SELECT DISTINCT ON (esc.salary_component_id)
           esc.salary_component_id, esc.amount, sc.name, sc.type, sc.is_taxable
         FROM employee_salary_components esc
         JOIN salary_components sc ON esc.salary_component_id = sc.id
         WHERE esc.employee_id = $1 AND esc.effective_date <= $2
         ORDER BY esc.salary_component_id, esc.effective_date DESC`,
        [emp.id, periodDate]
      );

      let totalAdditions = 0;
      let totalDeductions = 0;
      for (const c of componentsResult.rows) {
        const amt = parseFloat(c.amount) || 0;
        if (c.type === 'addition') totalAdditions += amt;
        else if (c.type === 'deduction') totalDeductions += amt;
      }

      const grossSalary = basicSalary + totalAdditions;
      const bpjs = calculateBpjs(grossSalary, bpjsConfig);

      const ptkpAmount = ptkpMap[emp.tax_status] ?? ptkpMap['TK/0'] ?? 0;
      const pph = calculatePph21(grossSalary, bpjs, ptkpAmount, bracketsResult.rows);

      const netSalary = grossSalary - totalDeductions
        - bpjs.bpjsk_employee - bpjs.bpjstk_jht - bpjs.bpjstk_jp
        - pph.pph21_monthly;

      totalNetAll += netSalary;

      const payslipResult = await client.query(
        `INSERT INTO payslips (
           payroll_period_id, employee_id,
           working_days, present_days, late_days, absent_days, overtime_hours,
           basic_salary, total_additions, total_deductions, gross_salary,
           bpjsk_employee, bpjstk_jht, bpjstk_jp, total_overtime,
           annual_gross, biaya_jabatan, ptkp, pkp, pph21_annual, pph21_monthly,
           net_salary
         ) VALUES (
           $1,$2, $3,$4,0,0,0, $5,$6,$7,$8, $9,$10,$11,0,
           $12,$13,$14,$15,$16,$17, $18
         ) RETURNING id`,
        [
          period.id, emp.id,
          workingDays, workingDays, // present_days diasumsikan penuh (belum ada modul absensi)
          basicSalary, Math.round(totalAdditions), Math.round(totalDeductions), Math.round(grossSalary),
          bpjs.bpjsk_employee, bpjs.bpjstk_jht, bpjs.bpjstk_jp,
          pph.annual_gross, pph.biaya_jabatan, pph.ptkp, pph.pkp, pph.pph21_annual, pph.pph21_monthly,
          Math.round(netSalary)
        ]
      );
      const payslipId = payslipResult.rows[0].id;

      for (const c of componentsResult.rows) {
        await client.query(
          `INSERT INTO payslip_details (payslip_id, salary_component_id, component_name, type, amount)
           VALUES ($1, $2, $3, $4, $5)`,
          [payslipId, c.salary_component_id, c.name, c.type, c.amount]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: `Payroll periode ${month}/${year} berhasil dibuat untuk ${employees.rows.length} karyawan` +
        (skipped > 0 ? `. ${skipped} karyawan dilewati karena belum punya jabatan aktif.` : ''),
      payroll_period: period,
      employee_count: employees.rows.length,
      skipped_count: skipped,
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
      `SELECT pp.*,
        COUNT(ps.id) as employee_count,
        COALESCE(SUM(ps.net_salary), 0) as total_net
       FROM payroll_periods pp
       LEFT JOIN payslips ps ON ps.payroll_period_id = pp.id
       WHERE pp.company_id = $1
       GROUP BY pp.id
       ORDER BY pp.year DESC, pp.month DESC`,
      [req.user.company_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Detail 1 periode payroll, dengan paginasi untuk daftar karyawannya
const getById = async (req, res) => {
  try {
    const period = await pool.query(
      `SELECT * FROM payroll_periods WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    if (period.rows.length === 0)
      return res.status(404).json({ message: 'Data payroll tidak ditemukan' });

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
    const offset = (page - 1) * limit;

    const totalResult = await pool.query(
      `SELECT COUNT(*) FROM payslips WHERE payroll_period_id = $1`,
      [req.params.id]
    );
    const total = parseInt(totalResult.rows[0].count);

    const items = await pool.query(
      `SELECT ps.*, e.full_name as employee_name, e.employee_code,
        pos.name as position_name, d.name as department_name
       FROM payslips ps
       JOIN employees e ON ps.employee_id = e.id
       LEFT JOIN employee_positions ep ON ep.employee_id = e.id AND ep.is_current = true
       LEFT JOIN positions pos ON ep.position_id = pos.id
       LEFT JOIN departments d ON pos.department_id = d.id
       WHERE ps.payroll_period_id = $1
       ORDER BY e.full_name
       LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    );

    res.json({
      ...period.rows[0],
      items: items.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 }
    });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Slip gaji 1 karyawan, lengkap dengan rincian PPh21 & BPJS
const getSlip = async (req, res) => {
  try {
    const item = await pool.query(
      `SELECT ps.*, pp.year, pp.month, pp.company_id,
        e.full_name as employee_name, e.employee_code,
        pos.name as position_name, d.name as department_name
       FROM payslips ps
       JOIN payroll_periods pp ON ps.payroll_period_id = pp.id
       JOIN employees e ON ps.employee_id = e.id
       LEFT JOIN employee_positions ep ON ep.employee_id = e.id AND ep.is_current = true
       LEFT JOIN positions pos ON ep.position_id = pos.id
       LEFT JOIN departments d ON pos.department_id = d.id
       WHERE ps.id = $1`,
      [req.params.itemId]
    );
    if (item.rows.length === 0 || item.rows[0].company_id !== req.user.company_id) {
      return res.status(404).json({ message: 'Slip tidak ditemukan' });
    }

    const components = await pool.query(
      `SELECT component_name, type, amount FROM payslip_details WHERE payslip_id = $1`,
      [req.params.itemId]
    );

    res.json({ ...item.rows[0], components: components.rows });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const finalize = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE payroll_periods SET status = 'finalized', paid_at = NOW()
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

const remove = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const period = await client.query(
      `SELECT * FROM payroll_periods WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    if (period.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Data tidak ditemukan' });
    }
    if (period.rows[0].status === 'finalized') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Payroll yang sudah difinalisasi tidak bisa dihapus' });
    }

    await client.query(
      `DELETE FROM payslip_details WHERE payslip_id IN (SELECT id FROM payslips WHERE payroll_period_id = $1)`,
      [req.params.id]
    );
    await client.query(`DELETE FROM payslips WHERE payroll_period_id = $1`, [req.params.id]);
    await client.query(`DELETE FROM payroll_periods WHERE id = $1`, [req.params.id]);

    await client.query('COMMIT');
    res.json({ message: 'Payroll draft berhasil dihapus' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  } finally {
    client.release();
  }
};

module.exports = { generate, getAll, getById, getSlip, finalize, remove };
