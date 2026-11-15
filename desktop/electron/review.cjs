// The care-team review as a PDF (Save as PDF, or Email it from Mail).
// The page renders the whole packet into a print-only layout first; this turns
// the window's print view into a PDF. Nothing is sent from here: Email opens a
// new message in Mail with the PDF attached, and the person picks who gets it.
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** A safe file name: "LoopStack review, Nov 14.pdf". No patient name, which the person can add. */
function pdfName(date = new Date()) {
  const d = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `LoopStack review, ${d}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
}

const PDF_OPTIONS = { printBackground: true, pageSize: 'Letter', margins: { marginType: 'default' }, preferCSSPageSize: true };

function register() {
  ipcMain.handle('review:pdf', async (e, input) => {
    const action = input?.action === 'email' ? 'email' : 'save';
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { ok: false, error: 'No window to print.' };
    try {
      const pdf = await e.sender.printToPDF(PDF_OPTIONS);
      if (action === 'save') {
        const r = await dialog.showSaveDialog(win, { title: 'Save the review as a PDF', defaultPath: path.join(app.getPath('documents'), pdfName()), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        if (r.canceled || !r.filePath) return { ok: true, canceled: true };
        fs.writeFileSync(r.filePath, pdf);
        return { ok: true, path: r.filePath };
      }
      if (process.platform !== 'darwin') return { ok: false, error: 'Email opens Mail, which is on macOS only. Save as PDF and attach it instead.' };
      const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'loopstack-review-'));
      const file = path.join(dir, pdfName());
      fs.writeFileSync(file, pdf, { mode: 0o600 });
      await new Promise((resolve, reject) => execFile('open', ['-a', 'Mail', file], (err) => (err ? reject(err) : resolve())));
      return { ok: true, path: file };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
}

module.exports = { register, pdfName };
