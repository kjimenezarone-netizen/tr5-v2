importScripts('report-schema.js', 'file-parser.js', 'tr-analysis.js', 'jszip.min.js', 'ruc.js', 'processing-engine.js');

self.onmessage = async ({ data }) => {
    try {
        const result = await ProcessingEngine.run(data.kind, data.files, {
            progress: message => postMessage({ event: 'progress', message })
        });
        postMessage({ event: 'done', result });
    } catch (error) {
        postMessage({ event: 'error', message: error.message, code: error.code });
    }
};
