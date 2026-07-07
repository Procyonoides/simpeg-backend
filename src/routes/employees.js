const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/employeeController');
const auth = require('../middleware/auth');

router.get('/', auth, ctrl.getAll);
router.get('/:id', auth, ctrl.getById);
router.post('/', auth, ctrl.create);
router.put('/:id', auth, ctrl.update);
router.put('/:id/change-position', auth, ctrl.changePosition);
router.delete('/:id', auth, ctrl.remove);

module.exports = router;