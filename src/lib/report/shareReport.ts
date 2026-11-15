import { Capacitor } from '@capacitor/core';

// Hand a finished export (PDF or HTML dashboard) to the person.
//
// On iPhone the WebView cannot download a blob or print, so the file is
// written to the app's cache and handed to the iOS share sheet — Mail,
// Messages, AirDrop, Files, Print — where the person chooses who receives it.
// Nothing is sent anywhere automatically. In the web preview it downloads.

export type ShareOutcome = 'shared' | 'downloaded' | 'dismissed';

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the PDF.'));
    reader.readAsDataURL(blob);
  });
}

export async function shareFile(blob: Blob, fileName: string, title: string): Promise<ShareOutcome> {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    // Cache, not Documents: the copy exists only to be shared and the OS may
    // reclaim it. The person keeps whatever they save from the share sheet.
    const written = await Filesystem.writeFile({ path: fileName, data: await toBase64(blob), directory: Directory.Cache });
    try {
      await Share.share({ title, files: [written.uri], dialogTitle: title });
      return 'shared';
    } catch (err) {
      // Closing the sheet rejects with "Share canceled" — not an error to show.
      if (err instanceof Error && /cancel/i.test(err.message)) return 'dismissed';
      throw err;
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  return 'downloaded';
}
