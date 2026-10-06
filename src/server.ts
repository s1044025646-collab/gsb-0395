import { startServer } from './app.js';

const configuredPort = process.env.PORT === undefined ? 0 : Number(process.env.PORT);
if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) {
  throw new Error('PORT 必须是 0 到 65535 的整数；0 表示自动选择空闲端口');
}

const running = await startServer(configuredPort);
console.log(`Kendall API 已启动: http://127.0.0.1:${running.port}`);
console.log('PORT=8080 npm start 可指定端口；默认由操作系统分配空闲端口。');

function shutdown() {
  running.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
