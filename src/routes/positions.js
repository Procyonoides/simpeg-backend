const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/positionController');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');

// Lihat data: semua role yang login boleh
router.get('/', auth, ctrl.getAll);
router.get('/:id', auth, ctrl.getById);

// Ubah master data: admin only
router.post('/', auth, checkRole('admin'), ctrl.create);
router.put('/:id', auth, checkRole('admin'), ctrl.update);
router.delete('/:id', auth, checkRole('admin'), ctrl.remove);

module.exports = router;
