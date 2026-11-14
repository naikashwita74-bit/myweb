const express = require('express');
const router = express.Router();
const transactionsController = require('../controllers/transactionsController');

router.get('/', transactionsController.getAll);
router.get('/:id', transactionsController.getById);
router.post('/', transactionsController.create);
router.put('/:id', transactionsController.update);
router.delete('/:id', transactionsController.delete);

module.exports = router;
