import { useState, useRef, useCallback } from 'react';

// Continuous, always-listening speech engine with silence-based finalization:
// instead of trusting the browser's own per-phrase "isFinal" cutoff (which can
// split sentences unpredictably), we buffer everything heard and only treat it
// as one finished command after ~3 seconds of true silence.
export function useSpeechRecognition({ onFinalTranscript, silenceTimeoutMs = 3000 }) {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState(null);
  const [supported] = useState(
    () => typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  );

  const recognitionRef = useRef(null);
  const pausedRef = useRef(false); // intentionally paused (e.g. while speaking) - don't auto-restart
  const silenceTimerRef = useRef(null);
  const bufferRef = useRef('');
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  onFinalTranscriptRef.current = onFinalTranscript;

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const start = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    setError(null);
    pausedRef.current = false;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setInterimText('');
      bufferRef.current = '';
    };

    recognition.onresult = event => {
      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalChunk += transcript;
        } else {
          interim += transcript;
        }
      }

      if (finalChunk) {
        bufferRef.current += finalChunk + ' ';
      }
      setInterimText((bufferRef.current + interim).trim());

      // Any new speech (interim or final) means they're still talking -
      // push the "they've gone quiet" deadline out by another 3 seconds.
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => {
        recognitionRef.current?.stop(); // deliberate stop -> finalized in onend below
      }, silenceTimeoutMs);
    };

    recognition.onerror = event => {
      // Both are routine noise during always-on listening, not real failures.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.error('SpeechRecognition error:', event.error);
      setError(event.error);
    };

    recognition.onend = () => {
      setIsListening(false);
      clearSilenceTimer();

      const finalText = bufferRef.current.trim();
      bufferRef.current = '';
      setInterimText('');

      if (finalText) {
        onFinalTranscriptRef.current(finalText);
      }

      // Only auto-restart if we weren't intentionally paused (e.g. for TTS).
      if (!pausedRef.current) {
        setTimeout(() => start(), 300);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silenceTimeoutMs]);

  const stop = useCallback(() => {
    pausedRef.current = true;
    clearSilenceTimer();
    recognitionRef.current?.stop();
  }, []);

  const pauseForSpeech = useCallback(() => {
    pausedRef.current = true;
    clearSilenceTimer();
    recognitionRef.current?.stop();
  }, []);

  const resumeAfterSpeech = useCallback(() => {
    pausedRef.current = false;
    start();
  }, [start]);

  return { isListening, interimText, error, supported, start, stop, pauseForSpeech, resumeAfterSpeech };
}

// Speaks a sentence back using the browser's built-in speech synthesis.
// Returns a promise that resolves once speaking is finished.
export function speak(text) {
  return new Promise(resolve => {
    if (!window.speechSynthesis || !text) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.02;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}
