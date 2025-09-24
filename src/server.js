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

const app = express();
app.use(cors());
app.use(express.json());

connectDB();

// Routes
app.use('/api/questions', questionRoutes);
app.use('/api/majors', majorRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/admin', adminRoutes);

app.get('/', (req, res) => res.send('Server is alive!'));

// Ping chính server để giữ cho Render không sleep
cron.schedule('*/5 * * * *', async () => {
  try {
    await axios.get(process.env.RENDER_URL || 'https://hollandbe.onrender.com');
    console.log('Pinged server to keep it awake');
  } catch (err) {
    console.error('Ping failed:', err.message);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
