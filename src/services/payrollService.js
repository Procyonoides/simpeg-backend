// Semua rate (bpjs_config.*_rate, pph21_config.rate) diasumsikan dalam bentuk
// DESIMAL, bukan persen langsung. Contoh: 1% ditulis 0.01, 5% ditulis 0.05.

// Hitung potongan BPJS porsi KARYAWAN (bukan porsi perusahaan)
function calculateBpjs(salary, bpjsConfig) {
  if (!bpjsConfig) {
    return { bpjsk_employee: 0, bpjstk_jht: 0, bpjstk_jp: 0 };
  }

  const bpjskCap = bpjsConfig.bpjsk_salary_cap ? parseFloat(bpjsConfig.bpjsk_salary_cap) : Infinity;
  const jpCap = bpjsConfig.jp_salary_cap ? parseFloat(bpjsConfig.jp_salary_cap) : Infinity;

  const bpjskBase = Math.min(salary, bpjskCap);
  const jpBase = Math.min(salary, jpCap);

  const bpjsk_employee = bpjskBase * (parseFloat(bpjsConfig.bpjsk_employee_rate) || 0);
  const bpjstk_jht = salary * (parseFloat(bpjsConfig.jht_employee_rate) || 0);
  const bpjstk_jp = jpBase * (parseFloat(bpjsConfig.jp_employee_rate) || 0);

  return {
    bpjsk_employee: Math.round(bpjsk_employee),
    bpjstk_jht: Math.round(bpjstk_jht),
    bpjstk_jp: Math.round(bpjstk_jp)
  };
}

// Hitung PPh 21 bulanan, metode disetahunkan (umum dipakai untuk pegawai tetap).
// taxBrackets: baris dari pph21_config { pkp_from, pkp_to, rate } terurut ASC.
function calculatePph21(grossMonthly, bpjsDeductions, ptkpAmount, taxBrackets) {
  const annual_gross = grossMonthly * 12;

  // Biaya jabatan: 5% dari bruto setahun, maksimal Rp6.000.000/tahun (aturan saat ini)
  const biaya_jabatan = Math.min(annual_gross * 0.05, 6000000);

  // Iuran JHT & JP porsi karyawan ikut mengurangi penghasilan neto, disetahunkan
  const annualBpjsDeduction = ((bpjsDeductions.bpjstk_jht || 0) + (bpjsDeductions.bpjstk_jp || 0)) * 12;

  const netIncome = annual_gross - biaya_jabatan - annualBpjsDeduction;
  const ptkp = ptkpAmount || 0;

  let pkp = Math.floor((netIncome - ptkp) / 1000) * 1000;
  if (pkp < 0) pkp = 0;

  let pph21_annual = 0;
  for (const bracket of taxBrackets) {
    const from = parseFloat(bracket.pkp_from);
    const to = bracket.pkp_to !== null && bracket.pkp_to !== undefined ? parseFloat(bracket.pkp_to) : Infinity;
    if (pkp > from) {
      const taxableInBracket = Math.min(pkp, to) - from;
      pph21_annual += taxableInBracket * (parseFloat(bracket.rate) || 0);
    }
  }

  return {
    annual_gross: Math.round(annual_gross),
    biaya_jabatan: Math.round(biaya_jabatan),
    ptkp: Math.round(ptkp),
    pkp: Math.round(pkp),
    pph21_annual: Math.round(pph21_annual),
    pph21_monthly: Math.round(pph21_annual / 12)
  };
}

// Hitung jumlah hari kerja (Senin-Jumat) dalam 1 bulan
function getWorkingDays(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month - 1, d).getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

module.exports = { calculateBpjs, calculatePph21, getWorkingDays };
