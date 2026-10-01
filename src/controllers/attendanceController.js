const pool = require('../config/db'); // Postgres
const { sql, getPool } = require('../config/mssql'); // SQL Server
// CATATAN: database absensi (SQL Server) HANYA DIBACA. Jangan pernah INSERT/UPDATE/DELETE di sini.

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

const MAX_SESSION_HOURS = 13;
const LATE_TOLERANCE_MIN = 5;

// Jadwal rotasi operator produksi (schedule_type = 'shift')
const ROTATING_SHIFTS = [
  { code: 1, label: 'Pagi', startMin: 6 * 60 + 30, durationMin: 8 * 60 },       // 06:30 -> 14:30
  { code: 2, label: 'Siang', startMin: 14 * 60 + 30, durationMin: 7 * 60 + 30 }, // 14:30 -> 22:00
  { code: 3, label: 'Malam', startMin: 22 * 60, durationMin: 8 * 60 + 30 }       // 22:00 -> 06:30 (besoknya)
];

// Sabtu operator produksi (hari kerja terpendek): shift 1 & 2 bergeser, shift 3 tidak berubah.
function getRotatingSaturdaySchedule(shiftCode, base) {
  if (shiftCode === 1) return { ...base, durationMin: 5 * 60 };                          // 06:30 -> 11:30
  if (shiftCode === 2) return { ...base, startMin: 11 * 60 + 30, durationMin: 5 * 60 };  // 11:30 -> 16:30
  return base; // shift 3 tetap 22:00 -> 06:30
}

async function fetchScansInWindow(employeeCode, from, to) {
  const mssqlPool = await getPool();
  const result = await mssqlPool.request()
    .input('ssn', sql.VarChar, employeeCode)
    .input('from', sql.DateTime, from)
    .input('to', sql.DateTime, to)
    .query(`
      SELECT c.CHECKTIME AS scan_time
      FROM dbo.CHECKINOUT c
      JOIN dbo.USERINFO u ON c.USERID = u.USERID
      WHERE u.SSN = @ssn AND c.CHECKTIME >= @from AND c.CHECKTIME <= @to
      ORDER BY c.CHECKTIME
    `);
  return result.recordset.map(r => r.scan_time);
}

// "HH:MM" atau "HH:MM:SS" (format kolom TIME Postgres) -> menit sejak tengah malam
function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Cari shift rotasi terdekat (dipakai schedule_type = 'shift')
function detectRotatingShift(scanMs) {
  const dayStart = Math.floor(scanMs / DAY_MS) * DAY_MS;
  let best = null;
  for (const shift of ROTATING_SHIFTS) {
    for (const offset of [-1, 0, 1]) {
      const startMs = dayStart + offset * DAY_MS + shift.startMin * MIN_MS;
      const diff = Math.abs(scanMs - startMs);
      if (!best || diff < best.diff) best = { diff, startMs, code: shift.code, label: shift.label };
    }
  }
  const dayOfWeekAtStart = new Date(best.startMs).getUTCDay();
  let schedule = ROTATING_SHIFTS.find(s => s.code === best.code);
  if (dayOfWeekAtStart === 6) schedule = getRotatingSaturdaySchedule(best.code, schedule);
  if (schedule.startMin !== ROTATING_SHIFTS.find(s => s.code === best.code).startMin) {
    const scheduleDayStart = Math.floor(best.startMs / DAY_MS) * DAY_MS;
    best.startMs = scheduleDayStart + schedule.startMin * MIN_MS;
  }
  best.durationMin = schedule.durationMin;
  return best;
}

// Jadwal 1 hari untuk karyawan jam tetap, berdasarkan hari dalam minggu scan itu sendiri
// (jam tetap tidak lewat tengah malam, jadi tidak perlu cari ke hari sebelum/sesudah).
function detectFixedShift(scanMs, employee) {
  const dayStart = Math.floor(scanMs / DAY_MS) * DAY_MS;
  const dow = new Date(dayStart).getUTCDay();

  let startMin, endMin;
  if (dow === 6) { // Sabtu
    startMin = timeToMinutes(employee.fixed_saturday_start);
    endMin = timeToMinutes(employee.fixed_saturday_end);
  } else if (dow !== 0) { // Senin-Jumat (Minggu dianggap libur kalau tidak diisi)
    startMin = timeToMinutes(employee.fixed_start_time);
    endMin = timeToMinutes(employee.fixed_end_time);
  }

  // Tidak ada jadwal di hari itu (Sabtu/Minggu libur) tapi ada scan — pakai jam Senin-Jumat sebagai fallback
  if (startMin == null || endMin == null) {
    startMin = timeToMinutes(employee.fixed_start_time) ?? 8 * 60;
    endMin = timeToMinutes(employee.fixed_end_time) ?? 17 * 60;
  }

  return {
    code: 9,
    label: 'Non-shift',
    startMs: dayStart + startMin * MIN_MS,
    durationMin: endMin - startMin
  };
}

function buildSessions(scans, employee) {
  const sessions = [];
  let current = null;

  for (const scan of scans) {
    const ms = new Date(scan).getTime();

    if (current && ms - current.startMs <= MAX_SESSION_HOURS * HOUR_MS) {
      current.last = scan;
      current.count++;
    } else {
      const shift = employee.schedule_type === 'fixed'
        ? detectFixedShift(ms, employee)
        : detectRotatingShift(ms);
      current = {
        first: scan,
        last: scan,
        startMs: ms,
        count: 1,
        shiftCode: shift.code,
        shiftLabel: shift.label,
        expectedStartMs: shift.startMs,
        expectedEndMs: shift.startMs + shift.durationMin * MIN_MS
      };
      sessions.push(current);
    }
  }
  return sessions;
}

// Rekap absensi 1 karyawan dalam 1 bulan, per SESI KERJA.
// `employee` = { schedule_type, fixed_start_time, fixed_end_time, fixed_saturday_start, fixed_saturday_end }
async function fetchAttendanceByCode(employeeCode, employee, year, month) {
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEnd = Date.UTC(year, month, 1);

  const scans = await fetchScansInWindow(
    employeeCode,
    new Date(monthStart - DAY_MS),
    new Date(monthEnd + DAY_MS)
  );

  return buildSessions(scans, employee || { schedule_type: 'shift' })
    .filter(s => s.startMs >= monthStart && s.startMs < monthEnd)
    .map(s => {
      const d = new Date(s.startMs);
      const checkInMs = new Date(s.first).getTime();
      const checkOutMs = s.count > 1 ? new Date(s.last).getTime() : null;

      const lateDiffMin = Math.round((checkInMs - s.expectedStartMs) / MIN_MS);
      const is_late = lateDiffMin > LATE_TOLERANCE_MIN;

      let is_early_leave = false;
      let early_minutes = 0;
      if (checkOutMs !== null) {
        const earlyDiffMin = Math.round((s.expectedEndMs - checkOutMs) / MIN_MS);
        is_early_leave = earlyDiffMin > LATE_TOLERANCE_MIN;
        early_minutes = is_early_leave ? earlyDiffMin : 0;
      }

      return {
        attendance_date: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
        check_in: s.first,
        check_out: checkOutMs !== null ? s.last : null,
        scan_count: s.count,
        shift_code: s.shiftCode,
        shift_label: s.shiftLabel,
        is_late,
        late_minutes: is_late ? lateDiffMin : 0,
        is_early_leave,
        early_minutes
      };
    });
}

// Admin/HR: lihat absensi karyawan tertentu
const getEmployeeAttendance = async (req, res) => {
  try {
    const emp = await pool.query(
      `SELECT employee_code, full_name, schedule_type,
              fixed_start_time, fixed_end_time, fixed_saturday_start, fixed_saturday_end
       FROM employees WHERE id = $1 AND company_id = $2`,
      [req.params.employeeId, req.user.company_id]
    );
    if (emp.rows.length === 0) {
      return res.status(404).json({ message: 'Karyawan tidak ditemukan' });
    }
    if (!emp.rows[0].employee_code) {
      return res.status(400).json({ message: 'Karyawan ini belum punya NIK/kode karyawan' });
    }

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);

    const records = await fetchAttendanceByCode(emp.rows[0].employee_code, emp.rows[0], year, month);
    res.json({ employee_name: emp.rows[0].full_name, year, month, records });
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengambil data absensi', error: err.message });
  }
};

// Karyawan: lihat absensi sendiri
const getMyAttendance = async (req, res) => {
  try {
    const emp = await pool.query(
      `SELECT employee_code, schedule_type,
              fixed_start_time, fixed_end_time, fixed_saturday_start, fixed_saturday_end
       FROM employees WHERE id = $1`,
      [req.user.employee_id]
    );
    if (emp.rows.length === 0 || !emp.rows[0].employee_code) {
      return res.status(400).json({ message: 'Data karyawan tidak lengkap' });
    }

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);

    const records = await fetchAttendanceByCode(emp.rows[0].employee_code, emp.rows[0], year, month);
    res.json({ year, month, records });
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengambil data absensi', error: err.message });
  }
};

// Dipakai Dashboard: jumlah karyawan yang sudah absen hari ini
const getTodayPresentCount = async (companyId) => {
  const mssqlPool = await getPool();
  const result = await mssqlPool.request().query(`
    SELECT DISTINCT u.SSN
    FROM dbo.CHECKINOUT c
    JOIN dbo.USERINFO u ON c.USERID = u.USERID
    WHERE CAST(c.CHECKTIME AS DATE) = CAST(GETDATE() AS DATE)
  `);
  const codesToday = result.recordset.map(r => r.SSN).filter(Boolean);
  if (codesToday.length === 0) return 0;

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM employees WHERE company_id = $1 AND status = 'active' AND employee_code = ANY($2)`,
    [companyId, codesToday]
  );
  return parseInt(countResult.rows[0].count);
};

module.exports = {
  getEmployeeAttendance,
  getMyAttendance,
  getTodayPresentCount,
  fetchAttendanceByCode,
  fetchScansInWindow
};