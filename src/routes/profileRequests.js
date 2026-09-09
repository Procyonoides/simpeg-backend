const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { getAll, approve, reject } = require('../controllers/profileRequestController');

// Admin & HR yang bisa lihat & approve/reject pengajuan perubahan data karyawan
router.get('/', auth, checkRole('admin', 'hr'), getAll);
router.patch('/:id/approve', auth, checkRole('admin', 'hr'), approve);
router.patch('/:id/reject', auth, checkRole('admin', 'hr'), reject);

module.exports = router;
