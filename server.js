import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  });
}

function handler(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }
  if (urlPath === '/') urlPath = '/web/index.html';

  // JSZip / PptxGenJS：从 node_modules 提供 UMD 构建（避免额外复制文件）
  if (urlPath === '/jszip.min.js') {
    return sendFile(res, path.join(ROOT, 'node_modules', 'jszip', 'dist', 'jszip.min.js'));
  }
  if (urlPath === '/pptxgen.min.js') {
    return sendFile(res, path.join(ROOT, 'node_modules', 'pptxgenjs', 'dist', 'pptxgen.min.js'));
  }

  const filePath = path.resolve(ROOT, '.' + urlPath);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  sendFile(res, filePath);
}

// 端口被占用时自动顺延，避免 EADDRINUSE 报错
const BASE_PORT = Number(process.env.PORT) || 3000;
function start(port) {
  const srv = http.createServer(handler);
  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < BASE_PORT + 20) {
      console.log(`端口 ${port} 被占用，改用 ${port + 1}`);
      start(port + 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
  srv.listen(port, () => console.log(`SlideCutter running at http://localhost:${port}`));
}
start(BASE_PORT);
