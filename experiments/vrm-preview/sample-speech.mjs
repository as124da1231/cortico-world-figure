import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// A short original line, synthesized offline with the installed Windows voice.
// Generated audio stays in ignored .local; no voice model or recording ships.
export async function prepareSampleSpeech(root) {
  const audio = join(root, '.local/demo-speech.wav'), metadata = join(root, '.local/demo-speech.json');
  try { await stat(audio); return JSON.parse((await readFile(metadata, 'utf8')).replace(/^\uFEFF/, '')); } catch { /* First local launch. */ }
  if (process.platform !== 'win32') return null;
  const ps = value => "'" + value.replaceAll("'", "''") + "'";
  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Speech',
    '$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '$voice = $speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq "zh-CN" } | Select-Object -First 1',
    '$line = "I am here. Take your time. What would you like to talk about?"',
    'if ($voice) { $speaker.SelectVoice($voice.VoiceInfo.Name); $line = "我走过来啦。你想和我聊聊吗？别着急，我在听。" }',
    '$speaker.Rate = -1',
    '$speaker.SetOutputToWaveFile(' + ps(audio) + ')',
    'try { $speaker.Speak($line) } finally { $speaker.Dispose() }',
    '@{ text = $line; source = "Windows local speech" } | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 -LiteralPath ' + ps(metadata),
  ].join('\n');
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { windowsHide: true, timeout: 25000 });
    return JSON.parse((await readFile(metadata, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) { console.warn(`本地试听语音未生成：${(error.stderr || error.code || 'Windows voice unavailable').toString().slice(-1200)}`); return null; }
}
