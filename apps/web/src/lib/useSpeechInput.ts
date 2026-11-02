import { useCallback, useEffect, useRef, useState } from 'react';

export type SpeechMode = 'webspeech' | 'server' | 'none';

interface RecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternative;
}

interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}

interface RecognitionErrorEvent {
  error: string;
}

interface RecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionInstance;

const MAX_SECONDS = 30;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function detectMode(): SpeechMode {
  if (recognitionCtor()) return 'webspeech';
  const canRecord =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined';
  if (canRecord) return 'server';
  return 'none';
}

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝，请在浏览器设置里允许后重试',
  'service-not-allowed': '浏览器语音服务被禁用，可改用服务端语音识别',
  'no-speech': '没有听到内容，请再试一次',
  network: '浏览器语音识别需要联网，网络不可用时请改用文字输入',
  'audio-capture': '未检测到可用麦克风',
  'language-not-supported': '当前浏览器不支持中文语音识别',
  aborted: '',
};

/**
 * 真实语音输入：
 * 1) Chrome / Edge / Android 走浏览器原生 Web Speech API，边说边上屏；
 * 2) 不支持的浏览器（如 iOS Safari）录音后交给服务端 ASR（需配置 ASR_MODE=http）；
 * 3) 两者都不可用时明确返回 none，由界面提示改用键盘，绝不做“假识别”。
 */
export function useSpeechInput(onText: (text: string, isFinal: boolean) => void) {
  const [mode, setMode] = useState<SpeechMode>('none');
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textRef = useRef(onText);

  useEffect(() => {
    textRef.current = onText;
  }, [onText]);

  useEffect(() => {
    setMode(detectMode());
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setListening(false);
    setElapsed(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startServerMode = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    streamRef.current = stream;
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      cleanup();
      if (!blob.size) {
        setError('没有录到声音，请再试一次');
        return;
      }
      setTranscribing(true);
      setError(null);
      try {
        const response = await fetch('/api/speech/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'audio/webm' },
          body: blob,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) {
          setError(data?.message ?? '语音识别失败，请改用文字输入');
          return;
        }
        textRef.current(String(data.text), true);
      } catch (err) {
        setError(err instanceof Error ? err.message : '语音识别服务不可达');
      } finally {
        setTranscribing(false);
      }
    };
    mediaRef.current = recorder;
    recorder.start();
    setListening(true);
    setElapsed(0);
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      setElapsed(seconds);
      if (seconds >= MAX_SECONDS) mediaRef.current?.stop();
    }, 500);
  }, [cleanup]);

  const startWebSpeech = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    let finalText = '';
    recognition.onstart = () => {
      setError(null);
      setListening(true);
    };
    recognition.onresult = (event) => {
      let live = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) {
          finalText += transcript;
          textRef.current(transcript, true);
        } else {
          live += transcript;
        }
      }
      setInterim(live || finalText);
    };
    recognition.onerror = (event) => {
      const message = ERROR_TEXT[event.error] ?? `语音识别失败（${event.error}）`;
      if (message) setError(message);
    };
    recognition.onend = () => {
      setInterim('');
      setListening(false);
      recognitionRef.current = null;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
    recognitionRef.current = recognition;
    recognition.start();
    timerRef.current = setInterval(() => {
      recognitionRef.current?.stop();
    }, MAX_SECONDS * 1000);
  }, []);

  const start = useCallback(() => {
    if (listening || transcribing) return;
    if (mode === 'webspeech') {
      startWebSpeech();
      return;
    }
    if (mode === 'server') {
      void startServerMode().catch((err: unknown) => {
        const message =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? '麦克风权限被拒绝，请在浏览器设置里允许后重试'
            : err instanceof Error
              ? err.message
              : '无法访问麦克风';
        setError(message);
        cleanup();
      });
      return;
    }
    setError('当前浏览器不支持语音输入，请改用文字或换用 Chrome / Edge');
  }, [cleanup, listening, mode, startServerMode, startWebSpeech, transcribing]);

  const stop = useCallback(() => {
    if (mode === 'webspeech') {
      recognitionRef.current?.stop();
      return;
    }
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop();
      return;
    }
    cleanup();
  }, [cleanup, mode]);

  return {
    mode,
    listening,
    transcribing,
    interim,
    error,
    elapsed,
    supported: mode !== 'none',
    label: mode === 'webspeech' ? '浏览器语音识别' : mode === 'server' ? '录音 + 服务端识别' : '不支持语音',
    start,
    stop,
    toggle: () => (listening || transcribing ? stop() : start()),
    clearError: () => setError(null),
  };
}
