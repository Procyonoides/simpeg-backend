const pool = require('../config/db');

const getAll = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    const searchQuery = search ? `AND (
      e.full_name ILIKE $4 OR 
      e.employee_code ILIKE $4 OR
      d.name ILIKE $4
    )` : '';

    const params = search 
      ? [req.user.company_id, limit, offset, `%${search}%`]
      : [req.user.company_id, limit, offset];

    const result = await pool.query(
      `SELECT e.*, 
        p.name as position_name,
        d.name as department_name
       FROM employees e
       LEFT JOIN employee_positions ep ON ep.employee_id = e.id AND ep.is_current = true
       LEFT JOIN positions p ON ep.position_id = p.id
       LEFT JOIN departments d ON p.department_id = d.id
       WHERE e.company_id = $1 ${searchQuery}
       ORDER BY e.full_name
       LIMIT $2 OFFSET $3`,
      params
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM employees e
       LEFT JOIN employee_positions ep ON ep.employee_id = e.id AND ep.is_current = true
       LEFT JOIN positions p ON ep.position_id = p.id
       LEFT JOIN departments d ON p.department_id = d.id
       WHERE e.company_id = $1 ${search ? 'AND (e.full_name ILIKE $2 OR e.employee_code ILIKE $2 OR d.name ILIKE $2)' : ''}`,
      search ? [req.user.company_id, `%${search}%`] : [req.user.company_id]
    );

    const total = parseInt(countResult.rows[0].count);

    res.json({
      data: result.rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const getById = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, 
        p.name as position_name,
        p.id as position_id,
        d.name as department_name,
        d.id as department_id
       FROM employees e
       LEFT JOIN employee_positions ep ON ep.employee_id = e.id AND ep.is_current = true
       LEFT JOIN positions p ON ep.position_id = p.id
       LEFT JOIN departments d ON p.department_id = d.id
       WHERE e.id = $1 AND e.company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Karyawan tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const create = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      employee_code, full_name, gender, birth_date, birth_place,
      nik, no_kk, address, phone, email, join_date,
      education, religion, tax_status, npwp,
      contract_type, bank_account, ibu_kandung,
      schedule_type, fixed_start_time, fixed_end_time,
      fixed_saturday_start, fixed_saturday_end,
      position_id  // jabatan awal
    } = req.body;

    const empResult = await client.query(
      `INSERT INTO employees (
        company_id, employee_code, full_name, gender, birth_date, birth_place,
        nik, no_kk, address, phone, email, join_date,
        education, religion, tax_status, npwp,
        contract_type, bank_account, ibu_kandung,
        schedule_type, fixed_start_time, fixed_end_time,
        fixed_saturday_start, fixed_saturday_end, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'active')
      RETURNING *`,
      [
        req.user.company_id, employee_code, full_name, gender, birth_date, birth_place,
        nik, no_kk, address, phone, email, join_date,
        education, religion, tax_status, npwp,
        contract_type, bank_account, ibu_kandung,
        schedule_type || 'shift',
        fixed_start_time || null, fixed_end_time || null,
        fixed_saturday_start || null, fixed_saturday_end || null
      ]
    );

    const employee = empResult.rows[0];

    if (position_id) {
      await client.query(
        `INSERT INTO employee_positions (employee_id, position_id, start_date, is_current)
         VALUES ($1, $2, $3, true)`,
        [employee.id, position_id, join_date]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(employee);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  } finally {
    client.release();
  }
};

const update = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      full_name, gender, birth_date, birth_place,
      nik, no_kk, address, phone, email,
      education, religion, tax_status, npwp,
      contract_type, bank_account, ibu_kandung, status,
      schedule_type, fixed_start_time, fixed_end_time,
      fixed_saturday_start, fixed_saturday_end,
      position_id, department_id
    } = req.body;

    const result = await client.query(
      `UPDATE employees SET
        full_name=$1, gender=$2, birth_date=$3, birth_place=$4,
        nik=$5, no_kk=$6, address=$7, phone=$8, email=$9,
        education=$10, religion=$11, tax_status=$12, npwp=$13,
        contract_type=$14, bank_account=$15, ibu_kandung=$16,
        status=$17,
        schedule_type=$18, fixed_start_time=$19, fixed_end_time=$20,
        fixed_saturday_start=$21, fixed_saturday_end=$22,
        updated_at=NOW()
       WHERE id=$23 AND company_id=$24 RETURNING *`,
      [
        full_name, gender, birth_date, birth_place,
        nik, no_kk, address, phone, email,
        education, religion, tax_status, npwp,
        contract_type, bank_account, ibu_kandung,
        status || 'active',
        schedule_type || 'shift',
        fixed_start_time || null, fixed_end_time || null,
        fixed_saturday_start || null, fixed_saturday_end || null,
        req.params.id, req.user.company_id
      ]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Karyawan tidak ditemukan' });
    }

    // Update jabatan kalau ada position_id
    if (position_id) {
      // Tutup jabatan lama
      await client.query(
        `UPDATE employee_positions SET is_current = false, end_date = NOW()
         WHERE employee_id = $1 AND is_current = true`,
        [req.params.id]
      );

      // Cek apakah jabatan baru sama dengan yang lama
      const existing = await client.query(
        `SELECT id FROM employee_positions 
         WHERE employee_id = $1 AND position_id = $2 AND is_current = false
         ORDER BY id DESC LIMIT 1`,
        [req.params.id, position_id]
      );

      // Insert jabatan baru
      await client.query(
        `INSERT INTO employee_positions (employee_id, position_id, start_date, is_current)
         VALUES ($1, $2, NOW(), true)`,
        [req.params.id, position_id]
      );
    }

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  } finally {
    client.release();
  }
};

// Mutasi jabatan
const changePosition = async (req, res) => {
  const { position_id, start_date, notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Tutup jabatan lama
    await client.query(
      `UPDATE employee_positions 
       SET is_current = false, end_date = $1
       WHERE employee_id = $2 AND is_current = true`,
      [start_date, req.params.id]
    );

    // Buka jabatan baru
    await client.query(
      `INSERT INTO employee_positions (employee_id, position_id, start_date, is_current, notes)
       VALUES ($1, $2, $3, true, $4)`,
      [req.params.id, position_id, start_date, notes]
    );

    await client.query('COMMIT');
    res.json({ message: 'Jabatan berhasil diubah' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  } finally {
    client.release();
  }
};

const remove = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE employees SET status = 'terminated', updated_at = NOW()
       WHERE id = $1 AND company_id = $2 RETURNING *`,
      [req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Karyawan tidak ditemukan' });
    res.json({ message: 'Karyawan berhasil dinonaktifkan' });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Toggle status aktif/nonaktif — sekalian matikan/aktifkan akun login portalnya
const toggleStatus = async (req, res) => {
  const { status } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE employees SET status = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3 RETURNING *`,
      [status, req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Karyawan tidak ditemukan' });
    }

    if (status === 'active') {
      // Aktif lagi (misal rehire) — nyalakan akun, wajib ganti password lagi demi keamanan
      await client.query(
        `UPDATE users SET is_active = true, must_change_password = true WHERE employee_id = $1`,
        [req.params.id]
      );
    } else {
      // Nonaktif/resign/terminated — matikan akun login portalnya
      await client.query(
        `UPDATE users SET is_active = false WHERE employee_id = $1`,
        [req.params.id]
      );
    }

    await client.query('COMMIT');
    res.json({ message: `Status berhasil diubah ke ${status}`, data: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  } finally {
    client.release();
  }
};

// Hapus permanen
const destroy = async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM employees WHERE id = $1 AND company_id = $2 RETURNING *`,
      [req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Karyawan tidak ditemukan' });
    res.json({ message: 'Karyawan berhasil dihapus permanen' });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const XLSX = require('xlsx');

// Export semua karyawan (sesuai filter search yang aktif) ke Excel
const exportEmployees = async (req, res) => {
  try {
    const search = req.query.search || '';
    const searchQuery = search ? `AND (
      e.full_name ILIKE $2 OR 
      e.employee_code ILIKE $2 OR
      d.name ILIKE $2
    )` : '';
    const params = search ? [req.user.company_id, `%${search}%`] : [req.user.company_id];

    const result = await pool.query(
      `SELECT e.employee_code, e.full_name, e.gender, e.phone, e.status, e.join_date,
        p.name as position_name, d.name as department_name
       FROM employees e
       LEFT JOIN employee_positions ep ON ep.employee_id = e.id AND ep.is_current = true
       LEFT JOIN positions p ON ep.position_id = p.id
       LEFT JOIN departments d ON p.department_id = d.id
       WHERE e.company_id = $1 ${searchQuery}
       ORDER BY e.full_name`,
      params
    );

    const rows = result.rows.map(r => ({
      'Kode Karyawan': r.employee_code || '-',
      'Nama Lengkap': r.full_name,
      'Jenis Kelamin': r.gender === 'M' ? 'Laki-laki' : r.gender === 'F' ? 'Perempuan' : '-',
      'Departemen': r.department_name || '-',
      'Jabatan': r.position_name || '-',
      'No. HP': r.phone || '-',
      'Status': r.status === 'active' ? 'Aktif' : r.status,
      'Tanggal Masuk': r.join_date ? new Date(r.join_date).toLocaleDateString('id-ID') : '-'
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 16 }, { wch: 28 }, { wch: 14 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 10 }, { wch: 14 }
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Karyawan');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="daftar-karyawan.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ message: 'Gagal export data', error: err.message });
  }
};

module.exports = { getAll, getById, create, update, changePosition, remove, toggleStatus, destroy, exportEmployees };