// TẠM THỜI: danh sách của các tính năng chưa có ở BE (nhờ báo giá R14, ngân hàng báo có tiền R17).
// Các màn lõi (lịch đặt của tôi, lịch đặt của chủ sân) tải kèm những danh sách này; khi chưa có bảng thì hệ thống
// thật sự chưa có bản ghi nào, nên trả mảng rỗng. Xóa từng dòng khi làm tính năng tương ứng.
const express = require('express');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const empty = (req, res) => res.json([]);

router.get('/owner/bank-events', requireRole('owner'), empty);
router.get('/requests/mine', requireRole(), empty);

module.exports = router;
