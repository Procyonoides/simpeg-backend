// Semua rate di sini khusus buat pola kerja 6 hari/minggu (Senin-Sabtu),
// sesuai Kepmenakertrans No. 102/2004.
// Dasar perhitungan: gaji pokok saja (bukan + tunjangan tetap) — penyederhanaan.

function calculateOvertimePay(basicSalary, hours, isHoliday) {
  const hourlyRate = basicSalary / 173;
  let pay = 0;
  let remaining = hours;

  if (!isHoliday) {
    // Hari kerja biasa: jam ke-1 = 1.5x, jam ke-2 dst = 2x
    const firstHour = Math.min(1, remaining);
    pay += firstHour * 1.5 * hourlyRate;
    remaining -= firstHour;

    if (remaining > 0) {
      pay += remaining * 2 * hourlyRate;
    }
  } else {
    // Hari libur/istirahat mingguan (6 hari kerja):
    // jam 1-7 = 2x, jam 8 = 3x, jam 9 dst = 4x
    const bracket1 = Math.min(7, remaining);
    pay += bracket1 * 2 * hourlyRate;
    remaining -= bracket1;

    if (remaining > 0) {
      const bracket2 = Math.min(1, remaining);
      pay += bracket2 * 3 * hourlyRate;
      remaining -= bracket2;
    }

    if (remaining > 0) {
      pay += remaining * 4 * hourlyRate;
    }
  }

  return Math.round(pay);
}

module.exports = { calculateOvertimePay };