const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');

router.get('/status', aiController.getStatus);
router.post('/analyze', aiController.analyze);
router.post('/question', aiController.ask);
router.get('/history', aiController.getHistory);

module.exports = router;
