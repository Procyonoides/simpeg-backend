const pool = require('../config/db');

const getAll = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, d.name as department_name 
       FROM positions p
       LEFT JOIN departments d ON p.department_id = d.id
       WHERE p.company_id = $1
       ORDER BY d.name, p.name`,
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
      `SELECT p.*, d.name as department_name 
       FROM positions p
       LEFT JOIN departments d ON p.department_id = d.id
       WHERE p.id = $1 AND p.company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Jabatan tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const create = async (req, res) => {
  const { department_id, name, basic_salary } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO positions (company_id, department_id, name, basic_salary)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.company_id, department_id, name, basic_salary || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const update = async (req, res) => {
  const { department_id, name, basic_salary } = req.body;
  try {
    const result = await pool.query(
      `UPDATE positions SET department_id = $1, name = $2, basic_salary = $3
       WHERE id = $4 AND company_id = $5 RETURNING *`,
      [department_id, name, basic_salary, req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Jabatan tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const remove = async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM positions WHERE id = $1 AND company_id = $2 RETURNING *`,
      [req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Jabatan tidak ditemukan' });
    res.json({ message: 'Jabatan berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

module.exports = { getAll, getById, create, update, remove };