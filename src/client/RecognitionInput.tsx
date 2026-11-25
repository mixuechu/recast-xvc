import { useState } from 'react';
import type { Workbench } from './useWorkbench';
export function RecognitionInput({
  model,
  running,
}: {
  model: Pick<Workbench, 'evidence' | 'config'>;
  running: boolean;
}) {
  const { evidence, config } = model;
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState('mp3');
  const [error, setError] = useState('');
  const disabled = evidence.busy || running || !config?.recognitionConfigured;
  return (
    <details className="recognition-config">
      <summary>火山辅助识别{!config?.recognitionConfigured && <span>待配置</span>}</summary>
      <div className="audio-input-modes" role="group" aria-label="音频来源">
        <button aria-pressed={mode === 'file'} onClick={() => setMode('file')}>
          上传音频
        </button>
        <button aria-pressed={mode === 'url'} onClick={() => setMode('url')}>
          音频链接
        </button>
      </div>
      {mode === 'file' ? (
        <>
          <label className="file-button audio-file-button">
            选择对应音频
            <input
              type="file"
              accept=".mp3,.wav,.m4a,.ogg,.aac"
              disabled={disabled}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                setError(
                  selected && selected.size > 24 * 1024 * 1024
                    ? '音频最多支持 24 MB，请压缩或裁剪后重试。'
                    : '',
                );
                setFile(selected && selected.size <= 24 * 1024 * 1024 ? selected : undefined);
                event.target.value = '';
              }}
            />
          </label>
          {file && (
            <p className="audio-filename">
              {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
            </p>
          )}
          <p>支持 MP3 / WAV / M4A / OGG / AAC，最多 24 MB。请使用与字幕时间轴一致的音轨。</p>
          {!config?.audioUploadConfigured && (
            <p className="inline-warning">
              本地上传需启用音频回调。请用 npm run dev:asr 启动，或改用音频链接。
            </p>
          )}
        </>
      ) : (
        <>
          <label htmlFor="audio-url">同一视频的公网音频链接</label>
          <input
            id="audio-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…/audio.mp3"
            disabled={disabled}
          />
          <label htmlFor="audio-format">音频格式</label>
          <select
            id="audio-format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            disabled={disabled}
          >
            {['mp3', 'wav', 'm4a', 'aac', 'ogg', 'amr', 'spx'].map((value) => (
              <option key={value} value={value}>
                {value.toUpperCase()}
              </option>
            ))}
          </select>
        </>
      )}
      <p>
        {mode === 'file'
          ? '音频临时保存 1 小时，通过随机下载链接供火山识别；删除文章会同时删除音频。'
          : '请确认音频链接可直接下载。'}
        识别可能产生费用。
      </p>
      {error && (
        <p className="evidence-error" role="alert">
          {error}
        </p>
      )}
      {!config?.recognitionConfigured && (
        <p className="inline-warning">服务端尚未配置 ASR，可先导入第二份字幕校对。</p>
      )}
      <button
        className="secondary"
        disabled={
          disabled || (mode === 'file' ? !file || !config?.audioUploadConfigured : !url.trim())
        }
        onClick={() =>
          mode === 'file' && file ? evidence.recognizeFile(file) : evidence.recognize(url, format)
        }
      >
        {evidence.busy ? '正在提交…' : mode === 'file' ? '上传并开始识别' : '开始辅助识别'}
      </button>
    </details>
  );
}
