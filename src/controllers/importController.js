const pool = require('../config/db');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const importEmployees = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'File tidak ditemukan' });

  const client = await pool.connect();
  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);

    await client.query('BEGIN');

    let success = 0;
    let skipped = 0;
    const errors = [];

    for (const row of rows) {
      try {
        // Skip kalau status OUT
        const status = row['STATUS']?.toString().trim().toUpperCase();
        if (status === 'OUT') { skipped++; continue; }

        const employee_code = row['NIK']?.toString().trim();
        const full_name = row['NAMA']?.toString().trim();
        if (!employee_code || !full_name) { skipped++; continue; }

        // Cek apakah sudah ada
        const existing = await client.query(
          'SELECT id FROM employees WHERE employee_code = $1 AND company_id = $2',
          [employee_code, req.user.company_id]
        );
        if (existing.rows.length > 0) { skipped++; continue; }

        // Parse tanggal
        const parseDateExcel = (val) => {
          if (!val) return null;
          if (typeof val === 'number') {
            const date = XLSX.SSF.parse_date_code(val);
            return `${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`;
          }
          const d = new Date(val);
          return isNaN(d) ? null : d.toISOString().split('T')[0];
        };

        const gender = row['L/P']?.toString().trim().toUpperCase() === 'L' ? 'male' : 'female';
        const tax_status = row['STATUS NPWP']?.toString().trim() || null;
        const contract_type = row['TETAP/TIDAK TETAP']?.toString().trim().toUpperCase().includes('TIDAK') ? 'PKWT' : 'PKWTT';

        await client.query(
          `INSERT INTO employees (
            company_id, employee_code, full_name, gender,
            birth_date, birth_place, nik, address, phone, email,
            join_date, education, religion, tax_status, npwp,
            contract_type, bank_account, status
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'active')`,
          [
            req.user.company_id,
            employee_code,
            full_name,
            gender,
            parseDateExcel(row['TANGGAL LAHIR']),
            row['TEMPAT LAHIR']?.toString().trim() || null,
            row['NIK KTP']?.toString().trim() || null,
            row['ALAMAT']?.toString().trim() || null,
            row['NO HP']?.toString().trim() || null,
            row['EMAIL']?.toString().trim() || null,
            parseDateExcel(row['TGL MASUK']),
            row['PENDIDIKAN']?.toString().trim() || null,
            row['AGAMA']?.toString().trim() || null,
            tax_status,
            row['NPWP']?.toString().trim() || null,
            contract_type,
            row['REKENING']?.toString().trim() || null,
          ]
        );
        success++;
      } catch (err) {
        errors.push({ row: row['NAMA'], error: err.message });
      }
    }

    await client.query('COMMIT');

    // Hapus file temp
    fs.unlinkSync(req.file.path);

    res.json({
      message: `Import selesai`,
      success,
      skipped,
      errors: errors.slice(0, 10)
    });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  } finally {
    client.release();
  }
};

module.exports = { importEmployees };