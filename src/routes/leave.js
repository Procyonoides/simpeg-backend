const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { getAll, getById, getBalance, create, approve, remove } = require('../controllers/leaveController');

router.get('/', auth, getAll);
router.get('/balance/:employeeId', auth, getBalance);
router.get('/:id', auth, getById);

// Pengajuan cuti: semua role yang login boleh ajukan
router.post('/', auth, create);

// Approve/tolak & hapus: admin & hr saja
router.patch('/:id/approve', auth, checkRole('admin', 'hr'), approve);
router.delete('/:id', auth, checkRole('admin', 'hr'), remove);

module.exports = router;
