import { useEffect, useMemo, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import {
  createExternalScannerHandlers,
  normalizeExternalCode,
  type ExternalScannerHandlers,
} from '../lib/external-scanner';

export function useExternalScanner(onSubmit: (code: string) => void, active: boolean) {
  const inputRef = useRef<TextInput>(null);
  const [displayCode, setDisplayCode] = useState('');
  const [focused, setFocused] = useState(false);
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const handlers = useMemo<ExternalScannerHandlers>(
    () =>
      createExternalScannerHandlers((code) => {
        setDisplayCode('');
        onSubmitRef.current(normalizeExternalCode(code));
      }),
    [],
  );

  useEffect(() => {
    if (!active) {
      handlers.reset();
      setDisplayCode('');
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, [active, handlers]);

  const refocus = () => {
    if (active) setTimeout(() => inputRef.current?.focus(), 150);
  };

  const clear = () => {
    handlers.reset();
    setDisplayCode('');
    refocus();
  };

  return {
    inputRef,
    displayCode,
    focused,
    setFocused,
    refocus,
    clear,
    onChangeText: (text: string) => {
      setDisplayCode(normalizeExternalCode(text));
      handlers.onChangeText(text);
    },
    onKeyPress: handlers.onKeyPress,
    onSubmitEditing: handlers.submitNow,
  };
}
