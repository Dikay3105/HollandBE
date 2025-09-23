// src/controllers/resultController.js
const Major = require('../models/Major');
const Student = require('../models/Student');

exports.submitResults = async (req, res) => {
    try {
        const { personalInfo, selectedBlocks, hollandScores, scores } = req.body;
        const { name, class: studentClass, number } = personalInfo;

        // 1️⃣ Lấy 3–4 nhóm Holland cao nhất (có thể đồng điểm)
        const sorted = Object.entries(hollandScores).sort((a, b) => b[1] - a[1]);
        const thirdScore = sorted[2]?.[1] ?? 0; // phòng trường hợp thiếu dữ liệu
        const topGroups = sorted
            .filter(([_, score]) => score >= thirdScore)
            .map(([group]) => group);

        // 2️⃣ Chỉ chọn ngành có đủ TẤT CẢ các nhóm topGroups
        const majors = await Major.find({
            examBlocks: { $in: selectedBlocks },
            hollandTypes: { $all: topGroups }
        }).lean();

        // 3️⃣ Tạo thông điệp phản hồi
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

        // 4️⃣ Lưu/Update thông tin Student: nếu cùng name + class + number thì UPDATE, không tạo mới
        const updatedStudent = await Student.findOneAndUpdate(
            { name, class: studentClass, number },       // điều kiện trùng khớp
            {
                $set: {
                    selectedBlocks,
                    hollandScores,
                    scores,
                    recommendedMajors: majors,
                    createdAt: new Date() // cập nhật thời gian cho lần làm mới nhất
                }
            },
            { new: true, upsert: true } // new: trả về document mới, upsert: không có thì tạo mới
        );

        // 5️⃣ Trả kết quả
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
