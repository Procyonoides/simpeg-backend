const express = require('express');
const router = express.Router();
const { register, login, profile, changePassword } = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.get('/profile', authMiddleware, profile);
router.patch('/change-password', authMiddleware, changePassword);

module.exports = router;