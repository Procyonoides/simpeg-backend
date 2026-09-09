const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const {
  getProfile, updateProfile, uploadPhoto, requestChange, getMyChangeRequests
} = require('../controllers/portalController');

if (!fs.existsSync('uploads/photos')) fs.mkdirSync('uploads/photos', { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/photos/'),
  filename: (req, file, cb) => cb(null, `emp${req.user.employee_id}-${Date.now()}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // maks 2MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!allowed.includes(path.extname(file.originalname).toLowerCase())) {
      return cb(new Error('Format file harus JPG, PNG, atau WEBP'));
    }
    cb(null, true);
  }
});

// Semua endpoint portal khusus role 'employee'
router.get('/profile', auth, checkRole('employee'), getProfile);
router.patch('/profile', auth, checkRole('employee'), updateProfile);
router.post('/photo', auth, checkRole('employee'), upload.single('photo'), uploadPhoto);
router.post('/change-requests', auth, checkRole('employee'), requestChange);
router.get('/change-requests', auth, checkRole('employee'), getMyChangeRequests);

module.exports = router;
