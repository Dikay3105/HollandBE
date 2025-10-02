// const mongoose = require('mongoose');
// const Major = require('./src/models/Major');
// const Question = require('./src/models/Question');
// const questions = require('./questions.json');
// const majors = require('./majors3.json');


// (async () => {
//     await mongoose.connect('mongodb+srv://dikay:khoa3105@cluster0.jzw7jpi.mongodb.net/holland?retryWrites=true&w=majority&appName=Cluster0', {
//         useNewUrlParser: true,
//         useUnifiedTopology: true,
//     });
//     await Major.insertMany(majors);
//     // await Question.insertMany(questions);
//     console.log('✅ Seed majors done');
//     process.exit();
// })();

const mongoose = require('mongoose');
const Student = require('./src/models/Student'); // đường dẫn tới file model Student

(async () => {
    try {
        await mongoose.connect('mongodb+srv://dikay:khoa3105@cluster0.jzw7jpi.mongodb.net/holland?retryWrites=true&w=majority&appName=Cluster0');
        // update toàn bộ student chưa có schoolYear
        const result = await Student.updateMany(
            { schoolYear: { $exists: false } },  // chỉ update doc nào chưa có schoolYear
            { $set: { schoolYear: 2025 } }
        );

        console.log(`✅ Đã update ${result.modifiedCount} học sinh với schoolYear = 2025`);

        await mongoose.disconnect();
    } catch (err) {
        console.error("❌ Lỗi:", err);
    }
})();

