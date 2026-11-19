const mongoose = require('mongoose');
const dns = require('dns');

// Trên một số máy Windows, Node không đọc được DNS của hệ thống (nhất là DNS IPv6)
// và rơi về 127.0.0.1 → query SRV của mongodb+srv bị ECONNREFUSED.
// Khi đó chuyển sang DNS công cộng.
if (dns.getServers().every(s => s === '127.0.0.1' || s === '::1')) {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ MongoDB connected');
    } catch (err) {
        console.error('❌ Mongo error', err);
        process.exit(1);
    }
};

module.exports = connectDB;
