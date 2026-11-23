// src/services/adviceQueue.js
// Hàng đợi viết lời khuyên AI – để lúc đông (cả lớp nộp cùng lúc) không dồn hết lên 1 nhà cung cấp rồi bị 429.
//
// - Tối đa AI_MAX_CONCURRENT bài viết cùng lúc (mặc định 8).
// - Chỉ bắt đầu bài mới khi còn lượt/phút ở ít nhất 1 nhà cung cấp (aiHelper.capacity), không thì chờ lượt trống.
// - Bài học sinh vừa nộp (priority cao) đi trước bài viết lại lời khuyên mẫu / khôi phục sau khởi động lại.
// - Có người đang xếp hàng → tắt luồng dự phòng (hedge) để không tốn đôi lượt cho 1 bài.
// - Báo vị trí trong hàng cho từng học sinh (onPosition) để trang kết quả hiện "đang xếp hàng".
//
// Chạy trong 1 tiến trình (Render 1 instance). Nhiều instance thì mỗi instance có hàng riêng.
const { capacity } = require('../helpers/aiHelper');

const MAX_CONCURRENT = Math.max(1, Number(process.env.AI_MAX_CONCURRENT) || 8);
const START_GRACE_MS = 3000; // bài vừa bắt đầu chưa kịp giữ lượt → tạm tính là đã chiếm 1 lượt

const waiting = []; // { run, priority, seq, onPosition, resolve, reject }
const recentStarts = [];
let running = 0;
let seq = 0;
let pumping = false;
let pumpAgain = false;
let timer = null;

const PRIORITY = { submit: 10, regenerate: 5, retry: 1 };

function notifyPositions() {
    waiting.forEach((job, i) => {
        if (job.lastPos !== i + 1) {
            job.lastPos = i + 1;
            try { job.onPosition?.(i + 1); } catch { /* bỏ qua */ }
        }
    });
}

function schedule(ms) {
    if (timer) return;
    timer = setTimeout(() => { timer = null; pump(); }, ms);
}

async function pump() {
    if (pumping) { pumpAgain = true; return; }
    pumping = true;
    try {
        while (running < MAX_CONCURRENT && waiting.length) {
            const now = Date.now();
            while (recentStarts.length && now - recentStarts[0] > START_GRACE_MS) recentStarts.shift();

            let cap;
            try { cap = await capacity(); } catch { cap = { free: Infinity, waitMs: 0 }; }
            const free = cap.free - recentStarts.length;
            if (free <= 0) {
                // kín lượt: chờ lượt trống gần nhất (hoặc chờ bài vừa bắt đầu giữ lượt xong)
                schedule(cap.free > 0 ? 1000 : Math.min(Math.max(cap.waitMs, 500), 5000));
                break;
            }

            const job = waiting.shift();
            running += 1;
            recentStarts.push(Date.now());
            notifyPositions();
            try { job.onPosition?.(0); } catch { /* bỏ qua */ } // 0 = tới lượt, AI bắt đầu viết
            Promise.resolve()
                .then(() => job.run({ allowHedge: () => waiting.length === 0 }))
                .then(job.resolve, job.reject)
                .finally(() => { running -= 1; pump(); });
        }
    } finally {
        pumping = false;
        if (pumpAgain) { pumpAgain = false; pump(); }
    }
}

/**
 * Thêm 1 bài vào hàng. Trả về Promise kết quả của run().
 * @param {(opts:{allowHedge:()=>boolean})=>Promise<any>} run
 * @param {{priority?: 'submit'|'regenerate'|'retry', onPosition?: (pos:number)=>void}} opts
 */
function enqueue(run, { priority = 'submit', onPosition } = {}) {
    return new Promise((resolve, reject) => {
        const job = { run, priority: PRIORITY[priority] ?? 0, seq: seq++, onPosition, resolve, reject, lastPos: null };
        // chèn theo ưu tiên, cùng ưu tiên thì ai tới trước đi trước
        let i = waiting.findIndex(j => j.priority < job.priority);
        if (i < 0) i = waiting.length;
        waiting.splice(i, 0, job);
        notifyPositions();
        pump();
    });
}

function stats() {
    return { running, waiting: waiting.length, maxConcurrent: MAX_CONCURRENT };
}

module.exports = { enqueue, stats };
