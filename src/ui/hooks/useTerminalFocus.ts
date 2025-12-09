import { useEffect, useState } from "react";
import { useStdin, useStdout } from "ink";

/**
 * Enable terminal focus reporting.
 * When enabled, the terminal sends:
 * - CSI I (\x1b[I) when terminal gains focus
 * - CSI O (\x1b[O) when terminal loses focus
 */
const ENABLE_FOCUS_REPORTING = "\x1b[?1004h";
const DISABLE_FOCUS_REPORTING = "\x1b[?1004l";

// Focus event sequences sent by the terminal
const FOCUS_IN_SEQUENCE = "\x1b[I";
const FOCUS_OUT_SEQUENCE = "\x1b[O";

/**
 * Hook that enables terminal focus reporting and triggers re-render
 * when the terminal regains focus. This fixes a visual bug where
 * content disappears when the terminal loses focus due to how Ink
 * uses ANSI escape sequences to erase and rewrite content.
 *
 * @returns Object with hasFocus boolean indicating current focus state
 */
export function useTerminalFocus(): { hasFocus: boolean } {
  const { stdin, isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
  const [hasFocus, setHasFocus] = useState(true);
  // Dummy state to force re-render on focus regain
  const [, setRenderTick] = useState(0);

  useEffect(() => {
    // Only enable focus reporting if raw mode is supported (i.e., interactive terminal)
    if (!isRawModeSupported || !stdin || !stdout) {
      return;
    }

    // Enable focus reporting
    stdout.write(ENABLE_FOCUS_REPORTING);

    // Buffer for accumulating input to detect escape sequences
    let buffer = "";

    const handleData = (data: Buffer | string) => {
      const str = data.toString();

      // Check for focus sequences in the input
      // They can come mixed with other input, so we need to scan for them
      buffer += str;

      // Process any complete focus sequences in the buffer
      let idx: number;

      // Check for focus in
      while ((idx = buffer.indexOf(FOCUS_IN_SEQUENCE)) !== -1) {
        setHasFocus(true);
        // Force a re-render by updating a tick counter
        // This causes React to re-render the component tree
        setRenderTick((t) => t + 1);
        buffer = buffer.slice(0, idx) + buffer.slice(idx + FOCUS_IN_SEQUENCE.length);
      }

      // Check for focus out
      while ((idx = buffer.indexOf(FOCUS_OUT_SEQUENCE)) !== -1) {
        setHasFocus(false);
        buffer = buffer.slice(0, idx) + buffer.slice(idx + FOCUS_OUT_SEQUENCE.length);
      }

      // Clear buffer if it gets too long (prevent memory leak)
      if (buffer.length > 100) {
        buffer = buffer.slice(-10);
      }
    };

    stdin.on("data", handleData);

    return () => {
      stdin.off("data", handleData);
      // Disable focus reporting on cleanup
      stdout.write(DISABLE_FOCUS_REPORTING);
    };
  }, [stdin, stdout, isRawModeSupported]);

  return { hasFocus };
}

