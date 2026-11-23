const { BANKS } = require('../rules');
const { badRequest } = require('../utils/errors');

/** Tài khoản nhận tiền do người dùng nhập: chỉ kiểm định dạng và ngân hàng có trong danh sách. */
function parseBank(bank) {
  const bin = String(bank?.bin || '');
  const account = String(bank?.account || '').replace(/\s/g, '');
  const accountName = String(bank?.accountName || '').trim().toUpperCase();
  if (!BANKS.some((x) => x.bin === bin)) throw badRequest('Chọn ngân hàng');
  if (!/^\d{6,19}$/.test(account)) throw badRequest('Số tài khoản gồm 6 đến 19 chữ số');
  if (accountName.length < 2 || accountName.length > 60) throw badRequest('Nhập tên chủ tài khoản');
  return { bin, account, accountName };
}

const bankName = (bin) => BANKS.find((x) => x.bin === bin)?.name || bin;

module.exports = { parseBank, bankName };
