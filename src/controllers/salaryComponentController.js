const pool = require('../config/db');

const getAll = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM salary_components WHERE company_id = $1 ORDER BY type, name`,
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
      `SELECT * FROM salary_components WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Komponen gaji tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const create = async (req, res) => {
  const { name, type, is_taxable, amount, is_percent } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO salary_components (company_id, name, type, is_taxable, amount, is_percent)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.company_id, name, type, is_taxable || false, amount || 0, is_percent || false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const update = async (req, res) => {
  const { name, type, is_taxable, amount, is_percent } = req.body;
  try {
    const result = await pool.query(
      `UPDATE salary_components 
       SET name = $1, type = $2, is_taxable = $3, amount = $4, is_percent = $5, updated_at = NOW()
       WHERE id = $6 AND company_id = $7 RETURNING *`,
      [name, type, is_taxable, amount, is_percent, req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Komponen gaji tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const remove = async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM salary_components WHERE id = $1 AND company_id = $2 RETURNING *`,
      [req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Komponen gaji tidak ditemukan' });
    res.json({ message: 'Komponen gaji berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

module.exports = { getAll, getById, create, update, remove };