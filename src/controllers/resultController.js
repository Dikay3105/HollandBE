// src/controllers/resultController.js
const Major = require('../models/Major');
const Student = require('../models/Student');

/**
 * Tạo tất cả tổ hợp (combination) k phần tử từ mảng arr
 */
function combinations(arr, k) {
    const result = [];
    const combo = [];
    function backtrack(start) {
        if (combo.length === k) {
            result.push(combo.slice());
            return;
        }
        for (let i = start; i < arr.length; i++) {
            combo.push(arr[i]);
            backtrack(i + 1);
            combo.pop();
        }
    }
    backtrack(0);
    return result;
}

/**
 * Sinh mọi hoán vị (permutation) của mảng
 */
function permutations(arr) {
    const res = [];
    const used = Array(arr.length).fill(false);
    const cur = [];
    function backtrack() {
        if (cur.length === arr.length) {
            res.push(cur.join(''));
            return;
        }
        for (let i = 0; i < arr.length; i++) {
            if (used[i]) continue;
            used[i] = true;
            cur.push(arr[i]);
            backtrack();
            cur.pop();
            used[i] = false;
        }
    }
    backtrack();
    return res;
}

exports.submitResults = async (req, res) => {
    try {
        const { personalInfo, selectedBlocks, hollandScores, scores } = req.body;
        const { name, class: studentClass, number } = personalInfo;

        // 1️⃣ Sắp xếp điểm giảm dần
        const sorted = Object.entries(hollandScores)
            .map(([k, v]) => [k.toUpperCase(), Number(v)])
            .sort((a, b) => b[1] - a[1]);

        if (sorted.length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Cần ít nhất 3 nhóm Holland để tính kết quả.'
            });
        }

        // 2️⃣ Xác định điểm nhóm thứ 3
        const thirdScore = sorted[2][1];

        // Lấy tất cả nhóm có điểm >= điểm nhóm thứ 3
        const candidateGroups = sorted
            .filter(([_, score]) => score >= thirdScore)
            .map(([group]) => group);

        // 3️⃣ Tạo tất cả chuỗi 3 ký tự có thể
        const comboSet = new Set();
        combinations(candidateGroups, 3).forEach(c =>
            permutations(c).forEach(p => comboSet.add(p))
        );
        const hollandCombos = Array.from(comboSet); // ví dụ ["RSI","RIS","IRS",...]

        // 4️⃣ Tìm ngành: khối thi khớp và hollandGroups chứa ít nhất 1 combo
        const majors = await Major.find({
            examBlocks: { $in: selectedBlocks },
            hollandGroups: { $in: hollandCombos }
        }).lean();

        // 5️⃣ Tạo thông điệp phản hồi
        let recommendationText;
        if (majors.length > 0) {
            const majorNames = majors.map(m => m.name).join(', ');
            recommendationText = [
                `Ngành nghề bạn có thể lựa chọn: ${majorNames}.`,
                'Để biến cơ hội thành hiện thực, hãy tiếp tục tập trung rèn luyện các môn thi đại học – chìa khóa giúp bạn tiến gần hơn đến mục tiêu.'
            ].join('\n');
        } else {
            recommendationText = [
                'Có vẻ chưa có sự ăn khớp giữa sở thích, năng lực của bạn với khối thi hiện tại.',
                'Bạn có thể trao đổi thêm với thầy cô hướng nghiệp để có góc nhìn rõ hơn.',
                'Nhưng quan trọng nhất, hãy tập trung phát huy 2 môn học thế mạnh – đó sẽ là bước đệm chắc chắn để bạn đạt được nguyện vọng.'
            ].join(' ');
        }

        // 6️⃣ Lưu hoặc cập nhật Student (upsert)
        const updatedStudent = await Student.findOneAndUpdate(
            { name, class: studentClass, number },
            {
                $set: {
                    selectedBlocks,
                    hollandScores,
                    scores,
                    recommendedMajors: majors,
                    createdAt: new Date()
                }
            },
            { new: true, upsert: true }
        );

        // 7️⃣ Trả kết quả
        res.json({
            success: true,
            message: 'Kết quả đã được xử lý',
            recommendedMajors: majors,
            recommendationText,
            student: updatedStudent
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
