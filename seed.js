const mongoose = require('mongoose');
const Major = require('./src/models/Major');
const Question = require('./src/models/Question');
const questions = require('./questions.json');
const majors = require('./majors3.json');


(async () => {
    await mongoose.connect('mongodb+srv://dikay:khoa3105@cluster0.jzw7jpi.mongodb.net/holland?retryWrites=true&w=majority&appName=Cluster0', {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
    await Major.insertMany(majors);
    // await Question.insertMany(questions);
    console.log('✅ Seed majors done');
    process.exit();
})();
