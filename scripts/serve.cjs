const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '../dist');
const config = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
const host = process.env.LEC_HOST || '127.0.0.1';
const port = Number(process.env.LEC_PORT || 8000);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.woff2': 'font/woff2' };

http.createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405).end();
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
        return res.writeHead(400).end();
    }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(404).end();
    let stat;
    try {
        stat = fs.statSync(file, { throwIfNoEntry: false });
    } catch {
        return res.writeHead(404).end();
    }
    if (!stat?.isFile()) return res.writeHead(404).end();
    const headers = {
        'Content-Security-Policy': config.csp + "; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8',
        'Content-Length': stat.size
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
}).listen(port, host, () => console.log('Lector en http://' + host + ':' + port));
