const express = require('express');
const router = express.Router();
const budgetsController = require('../controllers/budgetsController');

router.get('/:year/:month', budgetsController.getByYearAndMonth);
router.post('/', budgetsController.create);
router.put('/:id', budgetsController.update);

module.exports = router;
