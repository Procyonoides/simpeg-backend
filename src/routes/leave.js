const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getAll, getById, create, approve, remove } = require('../controllers/leaveController');

router.get('/', auth, getAll);
router.get('/:id', auth, getById);
router.post('/', auth, create);
router.patch('/:id/approve', auth, approve);
router.delete('/:id', auth, remove);

module.exports = router;