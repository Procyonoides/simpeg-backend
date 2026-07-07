const pool = require('../config/db');

const getAll = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM departments WHERE company_id = $1 ORDER BY name`,
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
      `SELECT * FROM departments WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Departemen tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const create = async (req, res) => {
  const { name, description } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO departments (company_id, name, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.user.company_id, name, description]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const update = async (req, res) => {
  const { name, description } = req.body;
  try {
    const result = await pool.query(
      `UPDATE departments SET name = $1, description = $2
       WHERE id = $3 AND company_id = $4 RETURNING *`,
      [name, description, req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Departemen tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const remove = async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM departments WHERE id = $1 AND company_id = $2 RETURNING *`,
      [req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Departemen tidak ditemukan' });
    res.json({ message: 'Departemen berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

module.exports = { getAll, getById, create, update, remove };