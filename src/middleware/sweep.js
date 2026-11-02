// Xử lý việc đã đến hạn (hết hạn giữ chỗ, hết lượt giữ quyền đặt) trước mỗi request, để lưới giờ và trạng thái lịch luôn
// đúng theo đồng hồ hệ thống kể cả khi bộ hẹn giờ của server chưa chạy (và trong test).
const { sweep } = require('../services/bookingOps');

async function sweepDue(req, res, next) {
  try {
    await sweep();
  } catch (err) {
    console.error('Quét hết hạn lỗi:', err.message); // lỗi ở đây không được làm hỏng request đang xử lý
  }
  next();
}

module.exports = { sweepDue };
