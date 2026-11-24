const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const browserify = require('browserify');
const { transformSync } = require('esbuild');
const { minify } = require('terser');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const template = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const modules = [
    'report-schema.js', 'file-parser.js', 'processing-engine.js', 'processing-client.js', 'processing-worker.js',
    'tr-analysis.js', 'tr-filters.js', 'tr-export.js', 'export-file.js', 'export-worker.js', 'workbook.js',
    'script.js', 'ruc.js', 'sheets-api.js', 'diagnostics.js', 'style.css'
];
const vendor = {
    'jszip.min.js': 'jszip/dist/jszip.min.js',
    'chart.umd.min.js': 'chart.js/dist/chart.umd.min.js',
    'html2pdf.bundle.min.js': 'html2pdf.js/dist/html2pdf.bundle.min.js',
    'open-sans-latin.woff2': '@fontsource-variable/open-sans/files/open-sans-latin-wght-normal.woff2'
};
const sha256 = data => createHash('sha256').update(data).digest('hex');

function configuration() {
    const apiUrl = (process.env.LEC_API_URL || '').trim();
    const telemetryMode = (process.env.LEC_TELEMETRY_MODE || 'OFF').toUpperCase();
    const withCredentials = process.env.LEC_API_CREDENTIALS === 'include';
    if (!['OFF', 'ANONYMOUS', 'INSTITUTIONAL'].includes(telemetryMode)) throw new Error('LEC_TELEMETRY_MODE no es válido.');
    if (!apiUrl && telemetryMode !== 'OFF') throw new Error('Configure LEC_API_URL antes de habilitar estadísticas.');
    let apiOrigin = null;
    if (apiUrl) {
        if (apiUrl.startsWith('/') && !apiUrl.startsWith('//') && !apiUrl.includes('\\')) {
            if (apiUrl.includes('#')) throw new Error('LEC_API_URL no puede incluir fragmentos.');
        } else {
            const url = new URL(apiUrl);
            if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
                throw new Error('Use una URL HTTPS sin credenciales ni fragmento en LEC_API_URL.');
            }
            apiOrigin = url.origin;
            if (!withCredentials) throw new Error('El acceso institucional externo requiere LEC_API_CREDENTIALS=include.');
        }
    }
    let revision = process.env.LEC_REVISION;
    if (!revision) {
        try {
            revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
            const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).length > 0;
            if (dirty) revision += '-local';
        } catch { revision = 'local'; }
    }
    if (!/^[a-zA-Z0-9._-]{1,40}$/.test(revision)) throw new Error('LEC_REVISION no es válida.');
    return { apiUrl, apiOrigin, telemetryMode, withCredentials, revision, version: pkg.version };
}

async function build() {
    const config = configuration();
    const content = new Map(modules.map(name => [name, fs.readFileSync(path.join(root, name))]));
    for (const [name, source] of Object.entries(vendor)) {
        content.set(name, fs.readFileSync(path.join(root, 'node_modules', source)));
    }
    const css = execFileSync(process.execPath, [
        require.resolve('tailwindcss/lib/cli.js'), '--config', path.join(root, 'tailwind.config.cjs'), '--minify'
    ], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
    content.set('tailwind.css', css);
    const excelSource = await new Promise((resolve, reject) => {
        const bundle = browserify(path.join(root, 'node_modules/exceljs/lib/exceljs.browser.js'), { standalone: 'ExcelJS' });
        bundle.transform({ global: true }, file => {
            if (!file.split(path.sep).includes('uuid') || !file.endsWith('.js')) return new Transform({ transform(chunk, _, done) { done(null, chunk); } });
            let source = '';
            return new Transform({
                transform(chunk, _, done) { source += chunk; done(); },
                flush(done) {
                    try { done(null, transformSync(source, { target: 'es2019', loader: 'js' }).code); }
                    catch (error) { done(error); }
                }
            });
        });
        bundle.bundle((error, bytes) => error ? reject(error) : resolve(bytes.toString()));
    });
    const excelBundle = await minify(excelSource, { format: { comments: /^!|@license|@preserve/ } });
    content.set('exceljs.min.js', Buffer.from(excelBundle.code));
    const configCode = 'const ReaderConfig = Object.freeze({ ...' + JSON.stringify(config)
        + ', assets: document.currentScript.src, asset(name) { return new URL(name, this.assets).href; } });\n';
    content.set('config.js', Buffer.from(configCode));

    const digests = Object.fromEntries([...content].map(([name, bytes]) => [name, sha256(bytes)]));
    const release = sha256(template + JSON.stringify(digests)).slice(0, 16);
    const assets = path.join('assets', release);
    const connect = new Set(["'self'"]);
    if (config.apiOrigin) connect.add(config.apiOrigin);
    if (config.apiOrigin === 'https://script.google.com') connect.add('https://script.googleusercontent.com');
    const directives = [
        "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
        "font-src 'self' data:", 'connect-src ' + [...connect].join(' '), "worker-src 'self'",
        "object-src 'none'", "base-uri 'none'", "form-action 'self'"
    ];
    const csp = directives.join('; ');
    const index = template.replace('<!-- CONTENT_SECURITY_POLICY -->', '<meta http-equiv="Content-Security-Policy" content="' + csp + '">')
        .replaceAll('ASSET_ROOT', 'assets/' + release);

    fs.rmSync(output, { recursive: true, force: true });
    fs.mkdirSync(path.join(output, assets), { recursive: true });
    for (const [name, bytes] of content) fs.writeFileSync(path.join(output, assets, name), bytes);
    fs.writeFileSync(path.join(output, 'index.html'), index);
    fs.writeFileSync(path.join(output, '.nojekyll'), '');
    fs.writeFileSync(path.join(output, 'version.json'), JSON.stringify({
        version: config.version, revision: config.revision, assets: release, sha256: digests, csp, libraries: pkg.dependencies
    }, null, 2) + '\n');
    const licenses = path.join(output, 'licenses');
    fs.mkdirSync(licenses);
    for (const name of Object.keys(pkg.dependencies)) {
        const directory = path.join(root, 'node_modules', name);
        const entries = fs.readdirSync(directory).filter(file => /^licen[sc]e|^copying/i.test(file));
        for (const file of entries) fs.copyFileSync(path.join(directory, file), path.join(licenses, name.replace('/', '-') + '-' + file));
    }
    const pdfLicense = path.join(root, 'node_modules/html2pdf.js/dist/html2pdf.bundle.min.js.LICENSE.txt');
    fs.copyFileSync(pdfLicense, path.join(licenses, 'html2pdf.bundle.LICENSE.txt'));
    console.log('Lector ' + config.version + ' (' + config.revision + ') · dist · ' + release);
}

build().catch(error => { console.error(error.message); process.exitCode = 1; });
