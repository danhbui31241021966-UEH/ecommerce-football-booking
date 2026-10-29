// Chạy prototype giao diện không cần MySQL: chỉ phục vụ thư mục public/ trên cổng cố định.
const express = require('express');
const path = require('path');

const PORT = 4100;
const app = express();
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.listen(PORT, '127.0.0.1', () => console.log(`Prototype: http://127.0.0.1:${PORT}/styleguide.html`));
