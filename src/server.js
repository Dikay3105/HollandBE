require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const cron = require('node-cron');
const axios = require('axios');

const majorRoutes = require('./routes/majorRoutes');
const studentRoutes = require('./routes/studentRoutes');
const questionRoutes = require('./routes/questionRoutes');
const resultRoutes = require('./routes/resultRoutes');
const adminRoutes = require('./routes/adminRoutes');
const optionRoutes = require('./routes/optionRoutes');
const { seedOptionsIfEmpty } = require('./controllers/optionController');
const { streamHandler } = require('./realtime');
const { resumePendingAdvice, retryFallbackAdvice } = require('./controllers/resultController');
const { ensureCatalog } = require('./services/catalog');
const { getPublicConfig } = require('./controllers/catalogController');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' })); // nhập danh sách ngành từ Excel

connectDB().then(async () => {
  await seedOptionsIfEmpty();
  await ensureCatalog(); // môn học, tổ hợp, cấu hình mặc định (chỉ lần đầu) + chuyển tổ hợp cũ sang mã môn
  resumePendingAdvice(); // chạy nền
  // Lời khuyên mẫu (AI hết quota lúc nộp bài) → tự viết lại bằng AI khi có lượt: mỗi 15 phút tối đa 10 em
  // (dừng ngay nếu AI vẫn chưa dùng được, nên không tốn lượt vô ích)
  setInterval(() => retryFallbackAdvice({ limit: 30 }), 15 * 60 * 1000); // ~120 bài/giờ, đi sau bài mới nộp (hàng đợi ưu tiên)
});

// Routes
app.use('/api/questions', questionRoutes);
app.use('/api/majors', majorRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/options', optionRoutes);
app.get('/api/config', getPublicConfig); // môn học, tổ hợp, số môn tự chọn cho form học sinh
app.get('/api/realtime', streamHandler); // SSE cho trang admin

app.get('/', (req, res) => res.send('Server is alive!'));

// Ping chính server để giữ cho Render không sleep
cron.schedule('*/1 * * * *', async () => {
  try {
    await axios.get(process.env.RENDER_URL || 'https://hollandbe.onrender.com');
    console.log('Pinged server to keep it awake');
  } catch (err) {
    console.error('Ping failed:', err.message);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
