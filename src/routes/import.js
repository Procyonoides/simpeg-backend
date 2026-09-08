const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { importEmployees } = require('../controllers/importController');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({ storage });

// Buat folder uploads kalau belum ada
const fs = require('fs');
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Import data karyawan: admin & hr saja
router.post('/employees', auth, checkRole('admin', 'hr'), upload.single('file'), importEmployees);

module.exports = router;
