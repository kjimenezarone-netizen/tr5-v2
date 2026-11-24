const ExportFile = {
    run(kind, data, progress) {
        return Processing.start('EXPORT_' + kind, 'export-worker.js', { kind, ...data }, progress);
    },
    save(bytes, filename) {
        const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        try {
            link.click();
        } finally {
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    },
    cancel(kind) { Processing.cancel('EXPORT_' + kind); }
};
