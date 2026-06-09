const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { initDatabase } = require('./database');

const adminRoutes = require('./routes/admin');
const staffRoutes = require('./routes/staff');
const queryRoutes = require('./routes/queries');

const app = express();
const PORT = 8078;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

app.get('/', (req, res) => {
  res.json({
    name: '鼓房管理系统 API',
    version: '1.0.0',
    description: '民间乐器房鼓具管理后端服务',
    endpoints: {
      admin: '/api/admin/*',
      staff: '/api/staff/*',
      queries: '/api/queries/*'
    }
  });
});

app.use('/api/admin', adminRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/queries', queryRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n========================================`);
      console.log(`  鼓房管理系统 API 服务已启动`);
      console.log(`  端口: ${PORT}`);
      console.log(`  访问: http://localhost:${PORT}`);
      console.log(`========================================\n`);
    });
  })
  .catch(err => {
    console.error('数据库初始化失败:', err);
    process.exit(1);
  });

module.exports = app;
