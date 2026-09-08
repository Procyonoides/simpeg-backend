const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { generate, getAll, getById, getSlip, finalize, remove } = require('../controllers/payrollController');

// Lihat data payroll: admin & hr
router.get('/', auth, checkRole('admin', 'hr'), getAll);
router.get('/slip/:itemId', auth, checkRole('admin', 'hr'), getSlip);
router.get('/:id', auth, checkRole('admin', 'hr'), getById);

// Proses payroll: admin & hr boleh generate, admin only yang finalize/hapus
router.post('/generate', auth, checkRole('admin', 'hr'), generate);
router.patch('/:id/finalize', auth, checkRole('admin'), finalize);
router.delete('/:id', auth, checkRole('admin'), remove);

module.exports = router;
