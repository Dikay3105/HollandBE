// src/realtime.js
// Đẩy sự kiện realtime bằng Server-Sent Events (SSE) – không cần thư viện thêm.
//
// - /api/realtime                       → kênh chung (trang admin): nhận broadcast()
// - /api/realtime?topic=student:<id>    → kênh riêng của 1 học sinh: chỉ nhận sendTo() của chính mình
//   (lời khuyên AI đang viết dở được stream qua đây, không làm nặng kênh của người khác)
//
// Lưu ý: client lưu trong bộ nhớ → chạy 1 instance (đúng với Render hiện tại).

const clients = new Map(); // res -> topic | null
const HEARTBEAT_MS = 25 * 1000; // giữ kết nối qua proxy (Render cắt kết nối im lặng)
const TOPIC_RE = /^student:[a-f0-9]{24}$/;

function streamHandler(req, res) {
    const rawTopic = typeof req.query.topic === 'string' ? req.query.topic : '';
    const topic = TOPIC_RE.test(rawTopic) ? rawTopic : null;

    res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n'); // trình duyệt tự kết nối lại sau 5s nếu rớt
    res.write(`event: ready\ndata: ${JSON.stringify({ topic })}\n\n`);

    clients.set(res, topic);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

    req.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
    });
}

function write(res, payload) {
    try {
        res.write(payload);
    } catch {
        clients.delete(res);
    }
}

/** Gửi tới kênh chung (trang admin). */
function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [res, topic] of clients) if (topic === null) write(res, payload);
}

/** Gửi tới các kết nối đang nghe 1 topic (VD: "student:<id>"). */
function sendTo(topic, event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [res, t] of clients) if (t === topic) write(res, payload);
}

module.exports = { streamHandler, broadcast, sendTo };
