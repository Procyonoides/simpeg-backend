const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const auth = require('../middleware/auth');
const { importEmployees } = require('../controllers/importController');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({ storage });

// Buat folder uploads kalau belum ada
const fs = require('fs');
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

router.post('/employees', auth, upload.single('file'), importEmployees);

module.exports = router;