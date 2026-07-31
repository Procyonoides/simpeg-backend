const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/employeeController');
const auth = require('../middleware/auth');
const { getAll, getById, create, update, changePosition, remove, toggleStatus, destroy } = require('../controllers/employeeController');

router.get('/', auth, ctrl.getAll);
router.get('/:id', auth, ctrl.getById);
router.post('/', auth, ctrl.create);
router.put('/:id', auth, ctrl.update);
router.put('/:id/change-position', auth, ctrl.changePosition);
router.delete('/:id', auth, ctrl.remove);
router.patch('/:id/status', auth, toggleStatus);
router.delete('/:id/permanent', auth, destroy);

module.exports = router;