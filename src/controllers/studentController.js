const Student = require('../models/Student');
const Major = require('../models/Major');

function getTop3Groups(scores) {
    return Object.entries(scores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k]) => k);
}

exports.createStudent = async (req, res) => {
    const { name, className, hollandScores, chosenMajorId, chosenExamBlock } = req.body;

    const major = await Major.findById(chosenMajorId);
    if (!major) return res.status(404).json({ message: "Ngành không tồn tại" });

    // kiểm tra khối thi hợp lệ
    const canApply = major.examBlocks.includes(chosenExamBlock);
    if (!canApply) {
        return res.status(400).json({
            message: `Khối ${chosenExamBlock} không hợp lệ cho ngành ${major.name}`
        });
    }

    const topGroups = getTop3Groups(hollandScores);
    const isMajorFit = major.hollandGroups.some(g => topGroups.includes(g));

    const student = await Student.create({
        name,
        class: className,
        hollandScores,
        topGroups,
        chosenMajor: { id: major._id, name: major.name },
        chosenExamBlock,
        isMajorFit
    });

    res.json(student);
};

exports.getStudents = async (req, res) => {
    const list = await Student.find().populate('chosenMajor.id');
    res.json(list);
};
