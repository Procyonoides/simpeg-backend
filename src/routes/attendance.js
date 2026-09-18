const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { getEmployeeAttendance } = require('../controllers/attendanceController');

router.get('/:employeeId', auth, checkRole('admin', 'hr'), getEmployeeAttendance);

module.exports = router;