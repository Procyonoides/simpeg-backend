const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { getAll, create, update, remove, bulkCreateEmployeeAccounts, resetEmployeePassword } = require('../controllers/userController');

// Semua endpoint manajemen user khusus admin
router.get('/', auth, checkRole('admin'), getAll);
router.post('/', auth, checkRole('admin'), create);
router.put('/:id', auth, checkRole('admin'), update);
router.delete('/:id', auth, checkRole('admin'), remove);

router.post('/bulk-create-employee-accounts', auth, checkRole('admin'), bulkCreateEmployeeAccounts);
router.post('/reset-employee-password/:employeeId', auth, checkRole('admin', 'hr'), resetEmployeePassword);

module.exports = router;
