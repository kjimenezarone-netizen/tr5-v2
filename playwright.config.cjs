const { defineConfig } = require('@playwright/test');

const localBrowser = process.env.LEC_CHROMIUM;
module.exports = defineConfig({
    testDir: 'tests/browser',
    workers: 1,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:8312',
        browserName: 'chromium',
        launchOptions: localBrowser ? {
            executablePath: localBrowser,
            args: JSON.parse(process.env.LEC_CHROMIUM_ARGS || '[]')
        } : {}
    },
    webServer: {
        command: 'node scripts/serve.cjs',
        url: 'http://127.0.0.1:8312',
        env: { LEC_PORT: '8312' }
    }
});
