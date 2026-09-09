const pool = require('../config/db');
const fs = require('fs');

// Field yang boleh diedit LANGSUNG oleh karyawan sendiri (data kontak, bukan data legal)
const DIRECT_EDIT_FIELDS = ['phone', 'address', 'bank_account'];
// Field yang perlu APPROVAL HR dulu sebelum berubah (data legal/administratif)
const APPROVAL_FIELDS = ['full_name'];

// Lihat profil sendiri
const getProfile = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id, e.employee_code, e.full_name, e.gender, e.birth_date, e.birth_place,
        e.address, e.phone, e.join_date, e.education, e.religion, e.tax_status,
        e.bank_account, e.status, e.photo_url,
        p.name as position_name, d.name as department_name
       FROM employees e
       LEFT JOIN employee_positions ep ON ep.employee_id = e.id AND ep.is_current = true
       LEFT JOIN positions p ON ep.position_id = p.id
       LEFT JOIN departments d ON p.department_id = d.id
       WHERE e.id = $1`,
      [req.user.employee_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Data karyawan tidak ditemukan' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Update field kontak yang boleh diedit langsung (phone, address, bank_account)
const updateProfile = async (req, res) => {
  const updates = {};
  for (const field of DIRECT_EDIT_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    return res.status(400).json({ message: 'Tidak ada data yang diubah' });
  }

  try {
    const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = keys.map(k => updates[k]);
    const result = await pool.query(
      `UPDATE employees SET ${setClauses} WHERE id = $1 RETURNING id, phone, address, bank_account`,
      [req.user.employee_id, ...values]
    );
    res.json({ message: 'Profil berhasil diperbarui', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Upload / ganti pasfoto
const uploadPhoto = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'File foto wajib diupload' });
  }
  try {
    const photoUrl = `/uploads/photos/${req.file.filename}`;

    // Hapus file foto lama kalau ada, biar gak numpuk
    const old = await pool.query(`SELECT photo_url FROM employees WHERE id = $1`, [req.user.employee_id]);
    const oldPath = old.rows[0]?.photo_url;
    if (oldPath && oldPath.startsWith('/uploads/photos/')) {
      const fullOldPath = '.' + oldPath;
      fs.unlink(fullOldPath, () => {});
    }

    await pool.query(`UPDATE employees SET photo_url = $1 WHERE id = $2`, [photoUrl, req.user.employee_id]);
    res.json({ message: 'Foto berhasil diperbarui', photo_url: photoUrl });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Ajukan perubahan data yang butuh approval HR (misal nama)
const requestChange = async (req, res) => {
  const { field_name, new_value } = req.body;
  if (!APPROVAL_FIELDS.includes(field_name)) {
    return res.status(400).json({ message: `Field ini tidak butuh approval atau tidak dikenal: ${field_name}` });
  }
  if (!new_value || !new_value.trim()) {
    return res.status(400).json({ message: 'Nilai baru wajib diisi' });
  }

  try {
    const pending = await pool.query(
      `SELECT id FROM employee_profile_change_requests
       WHERE employee_id = $1 AND field_name = $2 AND status = 'pending'`,
      [req.user.employee_id, field_name]
    );
    if (pending.rows.length > 0) {
      return res.status(400).json({ message: 'Kamu sudah punya pengajuan untuk field ini yang masih menunggu persetujuan' });
    }

    const current = await pool.query(`SELECT ${field_name} FROM employees WHERE id = $1`, [req.user.employee_id]);
    const oldValue = current.rows[0][field_name];

    await pool.query(
      `INSERT INTO employee_profile_change_requests (employee_id, field_name, old_value, new_value, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [req.user.employee_id, field_name, oldValue, new_value.trim()]
    );
    res.status(201).json({ message: 'Pengajuan perubahan berhasil dikirim, menunggu persetujuan HR/Admin' });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Riwayat pengajuan perubahan milik sendiri
const getMyChangeRequests = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM employee_profile_change_requests WHERE employee_id = $1 ORDER BY requested_at DESC`,
      [req.user.employee_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

module.exports = { getProfile, updateProfile, uploadPhoto, requestChange, getMyChangeRequests };
