const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/employeeController');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { getAll, getById, create, update, changePosition, remove, toggleStatus, destroy } = require('../controllers/employeeController');

// Lihat data: semua role yang login boleh
router.get('/', auth, ctrl.getAll);
router.get('/:id', auth, ctrl.getById);

// Ubah data: admin & hr
router.post('/', auth, checkRole('admin', 'hr'), ctrl.create);
router.put('/:id', auth, checkRole('admin', 'hr'), ctrl.update);
router.put('/:id/change-position', auth, checkRole('admin', 'hr'), ctrl.changePosition);
router.delete('/:id', auth, checkRole('admin', 'hr'), ctrl.remove);
router.patch('/:id/status', auth, checkRole('admin', 'hr'), toggleStatus);

// Hapus permanen: admin only
router.delete('/:id/permanent', auth, checkRole('admin'), destroy);

module.exports = router;
