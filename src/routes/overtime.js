const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const {
  getAllOvertimeRequests, approveOvertimeRequest, rejectOvertimeRequest,
  getAttendanceSuggestion, createRealization
} = require('../controllers/overtimeController');

// Semua endpoint di sini khusus admin & hr
router.get('/', auth, checkRole('admin', 'hr'), getAllOvertimeRequests);
router.patch('/:id/approve', auth, checkRole('admin', 'hr'), approveOvertimeRequest);
router.patch('/:id/reject', auth, checkRole('admin', 'hr'), rejectOvertimeRequest);
router.get('/:id/attendance-suggestion', auth, checkRole('admin', 'hr'), getAttendanceSuggestion);
router.post('/:id/realization', auth, checkRole('admin', 'hr'), createRealization);

module.exports = router;