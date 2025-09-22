// src/controllers/resultController.js
const Major = require('../models/Major');
const Student = require('../models/Student');

exports.submitResults = async (req, res) => {
    try {
        const { personalInfo, selectedBlocks, hollandScores } = req.body;

        // 1️⃣ Lấy 3–4 nhóm Holland cao nhất (nếu có đồng điểm)
        const sorted = Object.entries(hollandScores)
            .sort((a, b) => b[1] - a[1]);

        const thirdScore = sorted[2][1]; // điểm của nhóm đứng thứ 3
        const topGroups = sorted
            .filter(([_, score]) => score >= thirdScore)
            .map(([group]) => group);

        // 2️⃣ Chỉ chọn ngành có đủ TẤT CẢ các nhóm topGroups
        //    -> major.hollandTypes phải chứa mọi nhóm trong topGroups
        const majors = await Major.find({
            examBlocks: { $in: selectedBlocks },
            hollandTypes: { $all: topGroups } // << khác với $in
        }).lean();

        // 3️⃣ Tạo thông điệp phản hồi
        let recommendationText;
        if (majors.length > 0) {
            const majorNames = majors.map(m => m.name).join(', ');

            recommendationText = [
                `Ngành nghề bạn có thể lựa chọn: ${majorNames}.`,
                `Đặc điểm của nhóm ngành nghề này: ${topGroups.join(', ')}.`,
                'Để biến cơ hội thành hiện thực, hãy tiếp tục tập trung rèn luyện các môn thi đại học – chìa khóa giúp bạn tiến gần hơn đến mục tiêu.'
            ].join('\n');
        } else {
            recommendationText = [
                'Có vẻ chưa có sự ăn khớp giữa sở thích, năng lực của bạn với khối thi hiện tại.',
                'Bạn có thể trao đổi thêm với thầy cô hướng nghiệp để có góc nhìn rõ hơn.',
                'Nhưng quan trọng nhất, hãy tập trung phát huy 2 môn học thế mạnh – đó sẽ là bước đệm chắc chắn để bạn đạt được nguyện vọng.'
            ].join(' ');
        }

        // 4️⃣ Lưu thông tin student cùng kết quả
        const newStudent = await Student.create({
            name: personalInfo.name,
            class: personalInfo.class,
            class: personalInfo.class,
            selectedBlocks,
            hollandScores,
            recommendedMajors: majors
        });

        // 5️⃣ Trả kết quả
        res.json({
            success: true,
            message: 'Kết quả đã được xử lý',
            recommendedMajors: majors,
            recommendationText
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
