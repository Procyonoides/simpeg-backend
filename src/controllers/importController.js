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

    // Header ada di baris 2, data mulai baris 3
    const rows = XLSX.utils.sheet_to_json(sheet, { range: 1 }); // range:1 = skip baris pertama

    await client.query('BEGIN');

    let success = 0;
    let skipped = 0;
    const errors = [];

    for (const row of rows) {
      try {
        const status = row['STATUS']?.toString().trim().toUpperCase();
        if (status === 'OUT' || status === 'STATUS' || !status) { skipped++; continue; }

        const employee_code = row['NIK']?.toString().trim();
        const full_name = row['NAMA']?.toString().trim();
        if (!employee_code || !full_name || full_name === 'NAMA') { skipped++; continue; }

        // Cek duplikat
        const existing = await client.query(
          'SELECT id FROM employees WHERE employee_code = $1 AND company_id = $2',
          [employee_code, req.user.company_id]
        );
        if (existing.rows.length > 0) { skipped++; continue; }

        // Parse tanggal dari Excel
        const parseDateExcel = (val) => {
          if (!val) return null;
          if (val instanceof Date) return val.toISOString().split('T')[0];
          if (typeof val === 'number') {
            const date = XLSX.SSF.parse_date_code(val);
            return `${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`;
          }
          const d = new Date(val);
          return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
        };

        const gender = row['L/P']?.toString().trim().toUpperCase() === 'L' ? 'male' : 'female';
        const contract_type = row['TETAP/TIDAK TETAP']?.toString().trim().toUpperCase().includes('TIDAK') ? 'PKWT' : 'PKWTT';
        // Normalisasi tax_status
        const normalizeTaxStatus = (val) => {
            if (!val) return null;
            let v = val.toString().trim().toUpperCase();
            
            // Tambahkan garis miring kalau tidak ada
            // K0→K/0, K1→K/1, K2→K/2, K3→K/3
            // TK0→TK/0, TK1→TK/1, TK→TK/0
            v = v.replace(/^(K)(\d)$/, '$1/$2');       // K2 → K/2
            v = v.replace(/^(TK)(\d)$/, '$1/$2');      // TK2 → TK/2
            if (v === 'TK') v = 'TK/0';               // TK → TK/0
            if (v === 'K') v = 'K/0';                 // K → K/0

            // Validasi nilai yang diizinkan
            const valid = ['TK/0','TK/1','TK/2','TK/3','K/0','K/1','K/2','K/3'];
            return valid.includes(v) ? v : null;
        };

        const tax_status = normalizeTaxStatus(row['STATUS NPWP']);

        await client.query(
          `INSERT INTO employees (
            company_id, employee_code, full_name, gender,
            birth_date, birth_place, nik, address, phone,
            join_date, education, religion, tax_status, npwp,
            contract_type, bank_account, no_kk, ibu_kandung, status
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'active')`,
          [
            req.user.company_id,
            employee_code,
            full_name,
            gender,
            parseDateExcel(row['TANGGAL LAHIR']),
            row['TEMPAT LAHIR']?.toString().trim() || null,
            row['NIK KTP']?.toString().trim() || null,
            row['ALAMAT RUMAH']?.toString().trim() || null,
            row['NO HP']?.toString().trim() || null,
            parseDateExcel(row['TGL MASUK']),
            row['PENDIDIKAN']?.toString().trim() || null,
            row['AGAMA']?.toString().trim() || null,
            tax_status,
            row['NPWP']?.toString().trim() || null,
            contract_type,
            row['REKENING']?.toString().trim() || null,
            row['NO KK']?.toString().trim() || null,
            row['IBU KANDUNG']?.toString().trim() || null,
          ]
        );
        success++;
      } catch (err) {
        errors.push({ row: row['NAMA'], error: err.message });
      }
    }

    await client.query('COMMIT');
    fs.unlinkSync(req.file.path);

    res.json({ 
        message: 'Import selesai', 
        success, 
        skipped, 
        errors: errors.slice(0, 10),
        debug: rows.slice(0, 2)
    });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  } finally {
    client.release();
  }
};

module.exports = { importEmployees };