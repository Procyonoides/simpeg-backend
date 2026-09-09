const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Register perusahaan + superadmin
const register = async (req, res) => {
  const { company_name, company_address, company_phone, company_email, username, password } = req.body;

  try {
    // Buat perusahaan dulu
    const companyResult = await pool.query(
      `INSERT INTO companies (name, address, phone, email)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [company_name, company_address, company_phone, company_email]
    );
    const company_id = companyResult.rows[0].id;

    // Buat user superadmin untuk perusahaan ini
    const hashedPassword = await bcrypt.hash(password, 10);
    const userResult = await pool.query(
      `INSERT INTO users (company_id, username, password, role)
       VALUES ($1, $2, $3, 'admin') RETURNING id, username, role`,
      [company_id, username, hashedPassword]
    );

    res.status(201).json({
      message: 'Perusahaan berhasil didaftarkan',
      company_id,
      user: userResult.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Login
const login = async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT u.*, c.name as company_name 
       FROM users u
       JOIN companies c ON u.company_id = c.id
       WHERE u.username = $1 AND u.is_active = true`,
      [username]
    );

    if (result.rows.length === 0)
      return res.status(401).json({ message: 'Username tidak ditemukan' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(401).json({ message: 'Password salah' });

    const token = jwt.sign(
      { id: user.id, company_id: user.company_id, role: user.role, employee_id: user.employee_id || null },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        company_id: user.company_id,
        company_name: user.company_name,
        employee_id: user.employee_id || null,
        must_change_password: user.must_change_password
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Get profile
const profile = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.role, u.company_id, c.name as company_name
       FROM users u
       JOIN companies c ON u.company_id = c.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Ganti password sendiri (dipakai juga untuk alur wajib ganti password login pertama)
const changePassword = async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ message: 'Password lama dan password baru wajib diisi' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ message: 'Password baru minimal 6 karakter' });
  }

  try {
    const result = await pool.query(`SELECT * FROM users WHERE id = $1`, [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }
    const user = result.rows[0];

    const valid = await bcrypt.compare(current_password, user.password);
    if (!valid) {
      return res.status(401).json({ message: 'Password lama salah' });
    }

    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query(
      `UPDATE users SET password = $1, must_change_password = false WHERE id = $2`,
      [hashed, req.user.id]
    );

    res.json({ message: 'Password berhasil diganti' });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

module.exports = { register, login, profile, changePassword };