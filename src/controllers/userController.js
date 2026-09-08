const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const ALLOWED_ROLES = ['admin', 'hr', 'staff'];

// List semua user dalam 1 perusahaan (admin only)
const getAll = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, role, is_active, created_at
       FROM users WHERE company_id = $1 ORDER BY username`,
      [req.user.company_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Tambah user baru (hr/staff/admin) untuk perusahaan yang sama (admin only)
const create = async (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ message: 'Username, password, dan role wajib diisi' });
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ message: `Role tidak valid. Pilihan: ${ALLOWED_ROLES.join(', ')}` });
  }

  try {
    const existing = await pool.query(`SELECT id FROM users WHERE username = $1`, [username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'Username sudah dipakai' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (company_id, username, password, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, username, role, is_active, created_at`,
      [req.user.company_id, username, hashedPassword, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Ubah role atau status aktif user (admin only)
const update = async (req, res) => {
  const { role, is_active } = req.body;

  if (role && !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ message: `Role tidak valid. Pilihan: ${ALLOWED_ROLES.join(', ')}` });
  }
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ message: 'Tidak bisa mengubah role/status akun sendiri' });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET
        role = COALESCE($1, role),
        is_active = COALESCE($2, is_active)
       WHERE id = $3 AND company_id = $4
       RETURNING id, username, role, is_active`,
      [role, is_active, req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Hapus user (admin only) — tidak bisa hapus diri sendiri
const remove = async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ message: 'Tidak bisa menghapus akun sendiri' });
  }
  try {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 AND company_id = $2 RETURNING id`,
      [req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User tidak ditemukan' });
    res.json({ message: 'User berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

module.exports = { getAll, create, update, remove };
