const express = require('express');
const router = express.Router();
const catalogCtrl = require('../controllers/catalogController');

const { getStats } = require('../controllers/adminController');
const { getDetailedStats } = require('../controllers/statsController');
const optionCtrl = require('../controllers/optionController');
const questionCtrl = require('../controllers/questionController');

router.get('/stats', getStats);
router.get('/stats/detailed', getDetailedStats);
router.get('/ai-status', async (_, res) => res.json({ success: true, data: await require('../helpers/aiHelper').getAiStatus() }));

/* ======== Trường & ngành mong muốn (Option) CRUD ======== */
router.get('/options', optionCtrl.listOptions);
router.post('/options', optionCtrl.createOptions);
router.post('/options/import', optionCtrl.importOptions);
router.post('/options/import-majors', optionCtrl.importFromMajors);
router.get('/options/import-students/preview', optionCtrl.previewFromStudents);
router.post('/options/bulk-delete', optionCtrl.bulkDelete);
router.delete('/options/batch/:batchId', optionCtrl.undoBatch);
router.put('/options/:id', optionCtrl.updateOption);
router.delete('/options/:id', optionCtrl.deleteOption);
/* ======== Môn học ======== */
router.get('/subjects', catalogCtrl.listSubjects);
router.post('/subjects', catalogCtrl.createSubject);
router.put('/subjects/:id', catalogCtrl.updateSubject);
router.delete('/subjects/:id', catalogCtrl.deleteSubject);

/* ======== Tổ hợp xét tuyển ======== */
router.get('/exam-blocks', catalogCtrl.listBlocks);
router.post('/exam-blocks', catalogCtrl.createBlock);
router.put('/exam-blocks/:id', catalogCtrl.updateBlock);
router.delete('/exam-blocks/:id', catalogCtrl.deleteBlock);

/* ======== Question (Holland) CRUD ======== */
router.get('/questions', questionCtrl.listQuestions);
router.post('/questions', questionCtrl.createQuestions);
router.post('/questions/import', questionCtrl.importQuestions);
router.put('/questions/:id', questionCtrl.updateQuestion);
router.delete('/questions/:id', questionCtrl.deleteQuestion);

/* ======== Ngành ======== */
router.get('/majors', catalogCtrl.listMajors);
router.post('/majors', catalogCtrl.createMajor);
router.post('/majors/bulk', catalogCtrl.bulkUpdateMajors);
router.post('/majors/import', catalogCtrl.importMajors);
router.put('/majors/:id', catalogCtrl.updateMajor);
router.delete('/majors/:id', catalogCtrl.deleteMajor);

/* ======== Cấu hình tư vấn ======== */
router.get('/settings', catalogCtrl.getSettings);
router.put('/settings', catalogCtrl.updateSettings);
router.get('/catalog/health', catalogCtrl.getHealth);
router.post('/recommendation/preview', catalogCtrl.previewRecommendation);

module.exports = router;
