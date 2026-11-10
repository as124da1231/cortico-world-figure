import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { audioMime } from './voice-providers.mjs';

export interface SystemVoicePlayer {
  readonly canReportStart: boolean;
  warm(): void;
  play(audio: Buffer, volume: number, signal: AbortSignal, onStarted?: (startedAt: number) => void): Promise<void>;
  interrupt(): void;
  stop(): Promise<void>;
}

// Keep a single Windows player warm across clips, as in StreamVoice's WinMM player.
// Requests are JSON over stdin. No model text or file path becomes PowerShell code.
const WINMM = Buffer.from([
  "$ErrorActionPreference = 'Stop'",
  '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)',
  '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
  "Add-Type -Namespace FigureVoice -Name MCI -MemberDefinition '[DllImport(\"winmm.dll\", CharSet = CharSet.Unicode)] public static extern int mciSendString(string cmd, System.Text.StringBuilder ret, int len, System.IntPtr hwnd);'",
  "function MCI($command) { [FigureVoice.MCI]::mciSendString($command, $null, 0, [IntPtr]::Zero) }",
  'function ReadMCI($command) {',
  '  $reply = [Text.StringBuilder]::new(64)',
  '  $code = [FigureVoice.MCI]::mciSendString($command, $reply, $reply.Capacity, [IntPtr]::Zero)',
  '  if ($code -ne 0) { throw "MCI status failed ($code)" }',
  '  $reply.ToString()',
  '}',
  'function PlayObserved {',
  "  $code = MCI 'set figureVoiceClip time format milliseconds'",
  "  if ($code -eq 0) { $code = MCI 'play figureVoiceClip' }",
  '  if ($code -ne 0) { return $code }',
  '  $started = $false',
  '  $clock = [Diagnostics.Stopwatch]::StartNew()',
  '  while ($true) {',
  "    $mode = ReadMCI 'status figureVoiceClip mode'",
  "    if ($mode -eq 'stopped') {",
  '      if ($started) { return 0 }',
  '      if ($clock.ElapsedMilliseconds -ge 150) { return -2 }',
  '    }',
  "    if (!$started -and $mode -eq 'playing') {",
  "      $position = [long](ReadMCI 'status figureVoiceClip position')",
  '      if ($position -gt 0) {',
  '        $started = $true',
  '        $startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $position',
  "        [Console]::WriteLine(('START ' + $startedAt))",
  '      }',
  '    }',
  '    Start-Sleep -Milliseconds 8',
  '  }',
  '}',
  "[Console]::WriteLine('READY')",
  'while ($null -ne ($line = [Console]::ReadLine())) {',
  '  $opened = $false',
  '  try {',
  '    $job = ConvertFrom-Json -InputObject $line',
  '    $code = MCI (\'open "\' + $job.file + \'" type mpegvideo alias figureVoiceClip\')',
  '    $opened = $code -eq 0',
  '    if ($opened -and $job.volume -lt 1000) {',
  "      $code = MCI ('setaudio figureVoiceClip volume to ' + [int]$job.volume)",
  '    }',
  '    if ($code -eq 0) {',
  '      if ($job.reportStart) { $code = PlayObserved }',
  "      else { $code = MCI 'play figureVoiceClip wait' }",
  '    }',
  '  } catch { $code = -1 }',
  "  finally { if ($opened) { $closeCode = MCI 'close figureVoiceClip'; if ($code -eq 0) { $code = $closeCode } } }",
  "  [Console]::WriteLine(('RESULT ' + $code))",
  '}',
].join('\n'), 'utf16le').toString('base64');

const PLAY_TIMEOUT = 60_000;
const READY_TIMEOUT = 8_000;
const interrupted = () => new Error('语音已停止');

type Worker = {
  child: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  closed: Promise<void>;
  started?: (startedAt: number) => void;
  finish?: (error?: Error) => void;
  close(error: Error): void;
};

class DesktopPlayer implements SystemVoicePlayer {
  private readonly platform: 'win32' | 'darwin';
  private worker?: Worker;
  private active?: { controller: AbortController; task: Promise<void> };
  private closing = new Set<Promise<void>>();

  constructor(platform: 'win32' | 'darwin') { this.platform = platform; }

  get canReportStart() { return this.platform === 'win32'; }

  warm() {
    if (this.platform === 'win32') {
      try { void this.windowsWorker().ready.catch(() => {}); }
      catch { /* Playback will report the startup error on demand. */ }
    }
  }

  play(audio: Buffer, volume: number, signal: AbortSignal, onStarted?: (startedAt: number) => void): Promise<void> {
    signal.throwIfAborted();
    if (this.active) throw new Error('系统播放器正忙');
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('播放音量无效');
    if (onStarted && !this.canReportStart) throw new Error('当前系统播放器无法报告语音起点');
    const controller = new AbortController();
    const task = this.run(audio, volume, AbortSignal.any([signal, controller.signal]), onStarted).finally(() => {
      if (this.active?.controller === controller) this.active = undefined;
    });
    this.active = { controller, task };
    return task;
  }

  interrupt() {
    this.active?.controller.abort(interrupted());
  }

  async stop() {
    this.interrupt();
    this.worker?.close(interrupted());
    await this.active?.task.catch(() => {});
    await Promise.all(this.closing);
  }

  private async run(audio: Buffer, volume: number, signal: AbortSignal, onStarted?: (startedAt: number) => void) {
    const mime = audioMime(audio);
    const ext = mime === 'audio/mpeg' ? 'mp3' : mime === 'audio/wav' ? 'wav'
      : this.platform === 'darwin' && mime === 'audio/mp4' ? 'm4a'
      : this.platform === 'darwin' && mime === 'audio/flac' ? 'flac' : null;
    if (!ext) throw new Error('当前系统播放器无法播放该音频格式，请使用 MP3 或 WAV');
    const dir = await mkdtemp(join(tmpdir(), 'figure-voice-player-'));
    try {
      signal.throwIfAborted();
      const file = join(dir, 'clip.' + ext);
      await writeFile(file, audio, { flag: 'wx', signal });
      signal.throwIfAborted();
      if (this.platform === 'win32') await this.playWindows(file, volume, signal, onStarted);
      else await this.playMac(file, volume, signal);
    } finally {
      await rm(join(dir, 'clip.' + ext), { force: true }).catch(() => {});
      // This directory is private to the one clip. Avoid recursive removal.
      await rmdir(dir).catch(() => {});
    }
  }

  private windowsWorker(): Worker {
    if (this.worker) return this.worker;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', WINMM], {
      windowsHide: true, stdio: 'pipe',
    });
    child.stderr.resume();
    let ready!: () => void;
    let rejectReady!: (error: Error) => void;
    let closed!: () => void;
    const worker: Worker = {
      child,
      ready: new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; }),
      closed: new Promise<void>(resolve => { closed = resolve; }),
      close: error => {
        clearTimeout(timer);
        rejectReady(error);
        worker.finish?.(error);
        if (this.worker === worker) this.worker = undefined;
        if (!child.killed && child.exitCode === null && child.signalCode === null) child.kill();
      },
    };
    this.worker = worker;
    this.closing.add(worker.closed);
    void worker.ready.catch(() => {});
    const timer = setTimeout(() => worker.close(new Error('Windows 语音播放器启动超时')), READY_TIMEOUT);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (line === 'READY') { clearTimeout(timer); ready(); }
      else if (/^START \d+$/.test(line)) {
        const started = worker.started;
        worker.started = undefined;
        try { started?.(Number(line.slice(6))); }
        catch (error) { worker.close(error instanceof Error ? error : new Error(String(error))); }
      }
      else if (line === 'RESULT 0') worker.finish?.();
      else if (line === 'RESULT -2') worker.finish?.(new Error('Windows 语音播放器未观测到播放起点'));
      else if (/^RESULT -?\d+$/.test(line)) worker.close(new Error('Windows 无法播放这段音频（MCI ' + line.slice(7) + '）'));
    });
    child.stdin.on('error', () => worker.close(new Error('Windows 语音播放器的输入已关闭')));
    child.once('error', () => worker.close(new Error('无法启动 Windows 语音播放器')));
    child.once('close', () => {
      lines.close();
      worker.close(new Error('Windows 语音播放器已退出'));
      this.closing.delete(worker.closed);
      closed();
    });
    return worker;
  }

  private async playWindows(file: string, volume: number, signal: AbortSignal, onStarted?: (startedAt: number) => void) {
    const worker = this.windowsWorker();
    const abort = () => worker.close(signal.reason instanceof Error ? signal.reason : interrupted());
    signal.addEventListener('abort', abort, { once: true });
    try {
      await worker.ready;
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => worker.close(new Error('Windows 语音播放超时')), PLAY_TIMEOUT);
        worker.started = onStarted;
        worker.finish = error => {
          clearTimeout(timer);
          worker.started = undefined;
          worker.finish = undefined;
          if (error) reject(error); else resolve();
        };
        worker.child.stdin.write(JSON.stringify({ file, volume: Math.round(volume * 1000), reportStart: Boolean(onStarted) }) + '\n');
      });
    } finally {
      signal.removeEventListener('abort', abort);
      if (this.worker !== worker) await worker.closed;
    }
  }

  private playMac(file: string, volume: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn('afplay', ['-v', String(volume), file], { stdio: 'ignore' });
      let failure: Error | undefined;
      const cut = (error: Error) => { failure = error; child.kill('SIGKILL'); };
      const abort = () => cut(signal.reason instanceof Error ? signal.reason : interrupted());
      const timer = setTimeout(() => cut(new Error('系统语音播放超时')), PLAY_TIMEOUT);
      signal.addEventListener('abort', abort, { once: true });
      child.once('error', () => { failure ??= new Error('无法启动系统语音播放器'); });
      child.once('close', code => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (failure || code !== 0) reject(failure ?? new Error('系统无法播放这段音频'));
        else resolve();
      });
    });
  }
}

export function createSystemVoicePlayer(): SystemVoicePlayer | null {
  return process.platform === 'win32' || process.platform === 'darwin' ? new DesktopPlayer(process.platform) : null;
}
