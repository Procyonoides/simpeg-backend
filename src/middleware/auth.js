const jwt = require('jsonwebtoken');
const pool = require('../config/db');

module.exports = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Token tidak ada' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Cek ke database — token bisa aja masih valid (belum expired 8 jam),
    // tapi akunnya udah dimatiin admin (nonaktif/resign/terminated)
    const result = await pool.query(
      `SELECT is_active FROM users WHERE id = $1`,
      [decoded.id]
    );
    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(401).json({ message: 'Akun tidak aktif, silakan hubungi admin' });
    }

    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: 'Token tidak valid' });
  }
};