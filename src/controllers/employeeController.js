const pool = require('../config/db');

const getAll = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, 
        p.name as position_name,
        d.name as department_name
       FROM employees e
       LEFT JOIN employee_positions ep ON ep.employee_id = e.id AND ep.is_current = true
       LEFT JOIN positions p ON ep.position_id = p.id
       LEFT JOIN departments d ON p.department_id = d.id
       WHERE e.company_id = $1
       ORDER BY e.full_name`,
      [req.user.company_id]
    );
    res.json(result.rows);
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
      position_id  // jabatan awal
    } = req.body;

    // Insert karyawan
    const empResult = await client.query(
      `INSERT INTO employees (
        company_id, employee_code, full_name, gender, birth_date, birth_place,
        nik, no_kk, address, phone, email, join_date,
        education, religion, tax_status, npwp,
        contract_type, bank_account, ibu_kandung, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'active')
      RETURNING *`,
      [
        req.user.company_id, employee_code, full_name, gender, birth_date, birth_place,
        nik, no_kk, address, phone, email, join_date,
        education, religion, tax_status, npwp,
        contract_type, bank_account, ibu_kandung
      ]
    );

    const employee = empResult.rows[0];

    // Insert jabatan awal kalau ada
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
  const {
    full_name, gender, birth_date, birth_place,
    nik, no_kk, address, phone, email,
    education, religion, tax_status, npwp,
    contract_type, bank_account, ibu_kandung, status
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE employees SET
        full_name=$1, gender=$2, birth_date=$3, birth_place=$4,
        nik=$5, no_kk=$6, address=$7, phone=$8, email=$9,
        education=$10, religion=$11, tax_status=$12, npwp=$13,
        contract_type=$14, bank_account=$15, ibu_kandung=$16,
        status=$17, updated_at=NOW()
       WHERE id=$18 AND company_id=$19 RETURNING *`,
      [
        full_name, gender, birth_date, birth_place,
        nik, no_kk, address, phone, email,
        education, religion, tax_status, npwp,
        contract_type, bank_account, ibu_kandung, status,
        req.params.id, req.user.company_id
      ]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Karyawan tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
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

module.exports = { getAll, getById, create, update, changePosition, remove };