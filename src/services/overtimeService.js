// Pola kerja: 6 hari/minggu (Senin-Jumat 7 jam + 1 jam istirahat, Sabtu 5 jam), 40 jam/minggu.
// Dasar: Kepmenakertrans 102/2004 (tarif progresif tetap dipakai PP 35/2021).
// Dasar perhitungan: gaji pokok saja (bukan + tunjangan tetap) — penyederhanaan.

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

// Tiap tier: [jumlah jam, pengali upah sejam]
const TIERS = {
  weekday: [[1, 1.5], [Infinity, 2]],
  rest_day: [[7, 2], [1, 3], [Infinity, 4]],
  holiday_saturday: [[5, 2], [1, 3], [Infinity, 4]]
};

// Jam istirahat bergilir (2 grup pagi & siang, 3 grup malam) — cuma soal jadwal digilir,
// tiap orang tetap ambil 1 jam. Kalau rentang lembur menyentuh sebuah jendela, 1 jam dipotong.
const BREAK_BLOCKS = [
  { startMin: 10 * 60 + 30, endMin: 12 * 60 + 30 }, // pagi/siang: 10.30-11.30 & 11.30-12.30
  { startMin: 17 * 60 + 15, endMin: 19 * 60 + 15 }, // siang/malam: 17.15-18.15 & 18.15-19.15
  { startMin: 0 * 60 + 30, endMin: 3 * 60 + 30 }     // malam: 00.30-01.30, 01.30-02.30, 02.30-03.30
];

// dateStr format 'YYYY-MM-DD'. Dibaca sebagai UTC supaya hari tidak bergeser oleh zona waktu.
function getDayType(dateStr, isHoliday) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Minggu, 6 = Sabtu
  if (dow === 0) return 'rest_day';
  if (isHoliday) return dow === 6 ? 'holiday_saturday' : 'rest_day';
  return 'weekday';
}

// Menit istirahat yang tersentuh rentang [startMs, endMs). Dicek untuk hari mulainya
// dan hari sesudahnya, supaya lembur yang lewat tengah malam (shift malam) tetap kena.
function calcBreakDeductionMinutes(startMs, endMs) {
  const dayStart = Math.floor(startMs / DAY_MS) * DAY_MS;
  let deduction = 0;
  for (const dayOffset of [0, 1]) {
    const base = dayStart + dayOffset * DAY_MS;
    for (const block of BREAK_BLOCKS) {
      const blockStart = base + block.startMin * MIN_MS;
      const blockEnd = base + block.endMin * MIN_MS;
      const overlap = Math.min(endMs, blockEnd) - Math.max(startMs, blockStart);
      if (overlap > 0) deduction += 60;
    }
  }
  return deduction;
}

// dateStr + "HH:mm" -> rentang waktu absolut (menangani lewat tengah malam, mis. shift malam)
function toAbsoluteRange(dateStr, startStr, endStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  const startMs = Date.UTC(y, m - 1, d, sh, sm);
  let endMs = Date.UTC(y, m - 1, d, eh, em);
  if (endMs <= startMs) endMs += DAY_MS;
  return { startMs, endMs };
}

// Durasi lembur bersih (jam), setelah dipotong istirahat yang tersentuh.
function calcNetOvertimeHours(dateStr, actualStart, actualEnd) {
  const { startMs, endMs } = toAbsoluteRange(dateStr, actualStart, actualEnd);
  const rawMinutes = (endMs - startMs) / MIN_MS;
  const breakMinutes = Math.min(calcBreakDeductionMinutes(startMs, endMs), rawMinutes);
  return Math.round(((rawMinutes - breakMinutes) / 60) * 100) / 100;
}

// Rincian per tier, dipisah supaya nanti bisa ditampilkan di slip gaji
function getOvertimeBreakdown(basicSalary, hours, dayType) {
  const hourlyRate = basicSalary / 173;
  const tiers = TIERS[dayType] || TIERS.weekday;
  const breakdown = [];
  let remaining = hours;

  for (const [tierHours, multiplier] of tiers) {
    if (remaining <= 0) break;
    const h = Math.min(tierHours, remaining);
    breakdown.push({ hours: h, multiplier, amount: Math.round(h * multiplier * hourlyRate) });
    remaining -= h;
  }
  return breakdown;
}

function calculateOvertimePay(basicSalary, hours, dayType) {
  return getOvertimeBreakdown(basicSalary, hours, dayType)
    .reduce((sum, b) => sum + b.amount, 0);
}

module.exports = { calculateOvertimePay, getOvertimeBreakdown, getDayType, calcNetOvertimeHours };