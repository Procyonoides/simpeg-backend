const pool = require('../config/db');
const { calculateOvertimePay } = require('../services/overtimeService');
const { fetchAttendanceByCode } = require('./attendanceController');

// Hitung planned_hours dari jam mulai/selesai (format "HH:mm")
function calcHours(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60; // lewat tengah malam
  return Math.round((minutes / 60) * 100) / 100;
}

// ==== Karyawan (portal) ====

// Ajukan rencana lembur
const createOvertimeRequest = async (req, res) => {
  const { date, planned_start, planned_end, reason } = req.body;
  if (!date || !planned_start || !planned_end || !reason) {
    return res.status(400).json({ message: 'Semua field wajib diisi' });
  }
  try {
    const planned_hours = calcHours(planned_start, planned_end);
    const result = await pool.query(
      `INSERT INTO overtime_requests (employee_id, date, planned_start, planned_end, planned_hours, reason, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING *`,
      [req.user.employee_id, date, planned_start, planned_end, planned_hours, reason]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Riwayat pengajuan lembur milik sendiri
const getMyOvertimeRequests = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM overtime_requests WHERE employee_id = $1 ORDER BY date DESC`,
      [req.user.employee_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// ==== Admin/HR ====

// Daftar semua pengajuan lembur (bisa difilter status)
const getAllOvertimeRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const params = [req.user.company_id];
    let where = `WHERE e.company_id = $1`;
    if (status) { params.push(status); where += ` AND ovt.status = $${params.length}`; }

    const result = await pool.query(
      `SELECT ovt.*, e.full_name, e.employee_code,
        orl.id as realization_id, orl.actual_hours, orl.overtime_amount
       FROM overtime_requests ovt
       JOIN employees e ON ovt.employee_id = e.id
       LEFT JOIN overtime_realizations orl ON orl.overtime_request_id = ovt.id
       ${where}
       ORDER BY ovt.date DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const approveOvertimeRequest = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE overtime_requests ovt SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
       FROM employees e
       WHERE ovt.id = $2 AND ovt.employee_id = e.id AND e.company_id = $3 AND ovt.status = 'pending'
       RETURNING ovt.*`,
      [req.user.id, req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pengajuan tidak ditemukan atau sudah diproses' });
    }
    res.json({ message: 'Pengajuan lembur disetujui', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

const rejectOvertimeRequest = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE overtime_requests ovt SET status = 'rejected', approved_by = $1, approved_at = NOW(), updated_at = NOW()
       FROM employees e
       WHERE ovt.id = $2 AND ovt.employee_id = e.id AND e.company_id = $3 AND ovt.status = 'pending'
       RETURNING ovt.*`,
      [req.user.id, req.params.id, req.user.company_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pengajuan tidak ditemukan atau sudah diproses' });
    }
    res.json({ message: 'Pengajuan lembur ditolak', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// Bantu isi form realisasi: tarik jam masuk/pulang ASLI dari mesin fingerprint
// buat tanggal pengajuan itu, biar admin gak perlu ngetik manual
const getAttendanceSuggestion = async (req, res) => {
  try {
    const reqResult = await pool.query(
      `SELECT ovt.date, e.employee_code, e.company_id
       FROM overtime_requests ovt
       JOIN employees e ON ovt.employee_id = e.id
       WHERE ovt.id = $1`,
      [req.params.id]
    );
    if (reqResult.rows.length === 0 || reqResult.rows[0].company_id !== req.user.company_id) {
      return res.status(404).json({ message: 'Pengajuan tidak ditemukan' });
    }
    const { date, employee_code } = reqResult.rows[0];
    if (!employee_code) {
      return res.json({ check_in: null, check_out: null, message: 'Karyawan belum punya NIK, gak bisa ditarik dari absensi' });
    }

    const d = new Date(date);
    const records = await fetchAttendanceByCode(employee_code, d.getFullYear(), d.getMonth() + 1);
    const dateStr = d.toISOString().slice(0, 10);
    const match = records.find(r => new Date(r.attendance_date).toISOString().slice(0, 10) === dateStr);

    res.json({
      check_in: match ? match.check_in : null,
      check_out: match ? match.check_out : null
    });
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengambil saran dari data absensi', error: err.message });
  }
};

// Input realisasi lembur — hitung otomatis nilai rupiahnya
const createRealization = async (req, res) => {
  const { actual_start, actual_end, is_holiday } = req.body;
  if (!actual_start || !actual_end) {
    return res.status(400).json({ message: 'Jam mulai dan selesai aktual wajib diisi' });
  }

  try {
    const reqResult = await pool.query(
      `SELECT ovt.*, e.company_id, p.basic_salary
       FROM overtime_requests ovt
       JOIN employees e ON ovt.employee_id = e.id
       LEFT JOIN employee_positions ep ON ep.employee_id = e.id AND ep.is_current = true
       LEFT JOIN positions p ON ep.position_id = p.id
       WHERE ovt.id = $1`,
      [req.params.id]
    );
    if (reqResult.rows.length === 0 || reqResult.rows[0].company_id !== req.user.company_id) {
      return res.status(404).json({ message: 'Pengajuan tidak ditemukan' });
    }
    const ovt = reqResult.rows[0];
    if (ovt.status !== 'approved') {
      return res.status(400).json({ message: 'Cuma pengajuan yang sudah disetujui yang bisa direalisasikan' });
    }

    const existing = await pool.query(
      `SELECT id FROM overtime_realizations WHERE overtime_request_id = $1`,
      [req.params.id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'Realisasi untuk pengajuan ini sudah pernah diinput' });
    }

    const actualHours = calcHours(actual_start, actual_end);
    const basicSalary = parseFloat(ovt.basic_salary) || 0;
    const overtimeAmount = calculateOvertimePay(basicSalary, actualHours, !!is_holiday);

    const result = await pool.query(
      `INSERT INTO overtime_realizations
        (overtime_request_id, employee_id, date, actual_start, actual_end, actual_hours, overtime_amount, is_holiday)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.params.id, ovt.employee_id, ovt.date, actual_start, actual_end, actualHours, overtimeAmount, !!is_holiday]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

module.exports = {
  createOvertimeRequest, getMyOvertimeRequests,
  getAllOvertimeRequests, approveOvertimeRequest, rejectOvertimeRequest,
  getAttendanceSuggestion, createRealization
};