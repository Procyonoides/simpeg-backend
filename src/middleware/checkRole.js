// Middleware pengecekan role. Pakai setelah middleware `auth`.
// Contoh: router.post('/', auth, checkRole('admin', 'hr'), ctrl.create);
module.exports = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ message: 'Tidak terautentikasi' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Anda tidak memiliki akses untuk aksi ini' });
    }
    next();
  };
};
