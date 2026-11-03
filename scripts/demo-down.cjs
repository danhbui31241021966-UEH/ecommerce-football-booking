const { STATE, readState, removeState, processInfo, acquireLock, releaseLock, stopExact, tcpConnect } = require('./demo-lib.cjs');

async function run() {
  const lock = acquireLock('scripts/demo-down.cjs');
  try {
    const state = readState();
    if (!state) {
      console.log('Demo chưa chạy (không có state); không dừng process nào.');
      return;
    }
    let failed = false;
    for (const name of ['tunnel', 'server']) {
      const record = state.services?.[name];
      if (!record) continue;
      try {
        const result = stopExact(record, name);
        console.log(`${name}: ${result === 'stopped' ? 'đã dừng' : 'PID đã kết thúc'} (PID ${record.pid}).`);
      } catch (error) {
        failed = true;
        console.error(`${name}: ${error.message}`);
      }
    }
    if (state.services?.mysql) {
      const mysql = state.services.mysql;
      const running = processInfo(mysql.pid);
      if (running && running.start === mysql.started && running.command.includes(mysql.expected)) {
        console.log(`MySQL PID ${mysql.pid} tiếp tục chạy theo yêu cầu; demo:down không dừng MySQL.`);
      }
    }
    if (failed) throw new Error(`Không xóa ${STATE} vì còn PID chưa xác minh/dừng.`);
    removeState();
    if (await tcpConnect(3000)) console.error('Cảnh báo: cổng 3000 vẫn có listener; không dừng PID ngoài state.');
    else console.log('Cổng 3000 đã trống.');
  } finally { releaseLock(lock); }
}

run().catch((error) => { console.error(`demo:down: ${error.message}`); process.exitCode = 1; });
