import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Only local absolute paths; never return arbitrary clipboard text to the UI. */
export function clipboardPaths(value: string): string[] {
    const paths: string[] = [];
    for (const row of value.replace(/^\uFEFF/, '').split(/\r?\n/).slice(0, 32)) {
        let path = row.trim().replace(/^["']|["']$/g, '');
        if (/^file:/i.test(path)) {
            try {
                const url = new URL(path);
                if (url.hostname && url.hostname !== 'localhost')
                    continue;
                path = fileURLToPath(url);
            }
            catch {
                continue;
            }
        }
        if (path && !/[\x00-\x1f]/.test(path) && (isAbsolute(path) || /^[a-z]:[\\/]/i.test(path)))
            paths.push(path);
    }
    return [...new Set(paths)];
}
/** Read only after the person's Paste action. No polling, shell interpolation or logging. */
export async function readClipboardPaths(): Promise<string[]> {
    if (process.platform !== 'win32')
        return [];
    const script = `Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
  [System.Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { [Console]::WriteLine($_) }
} elseif ([System.Windows.Forms.Clipboard]::ContainsText()) {
  [Console]::Write([System.Windows.Forms.Clipboard]::GetText())
}`;
    const raw = await new Promise<string>((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.setEncoding('utf8');
        let out = '';
        const timer = setTimeout(() => { child.kill(); reject(new Error('读取剪贴板超时，请粘贴文件夹路径')); }, 5000);
        child.stdout.on('data', b => { out += b.toString('utf8'); if (out.length > 32768)
            child.kill(); });
        child.once('error', () => { clearTimeout(timer); reject(new Error('无法读取系统剪贴板，请粘贴文件夹路径')); });
        child.once('close', code => { clearTimeout(timer); if (code !== 0)
            reject(new Error('剪贴板暂不可用，请再试一次'));
        else
            resolve(out); });
    });
    return clipboardPaths(raw);
}
