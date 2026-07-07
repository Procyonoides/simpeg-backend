const express = require('express');
const cors = require('cors');
require('dotenv').config();
require('./src/config/db');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Simpeg API running...' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Routes
const authRoutes = require('./src/routes/auth');
const departmentRoutes = require('./src/routes/departments');
const positionRoutes = require('./src/routes/positions');
const salaryComponentRoutes = require('./src/routes/salaryComponents');
const employeeRoutes = require('./src/routes/employees');
const importRoutes = require('./src/routes/import');

app.use('/api/auth', authRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/salary-components', salaryComponentRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/import', importRoutes);