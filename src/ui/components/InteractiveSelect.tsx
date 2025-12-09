import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";

export interface SelectOption {
  label: string;
  value: string;
  hint?: string;
}

export interface InteractiveSelectProps {
  /**
   * Title to display above the select
   */
  readonly title?: string;
  /**
   * Options to display
   */
  readonly options: SelectOption[];
  /**
   * Called when an option is selected (Enter pressed)
   */
  readonly onSelect: (value: string) => void;
  /**
   * Called when selection is cancelled (ESC pressed)
   */
  readonly onCancel: () => void;
  /**
   * Number of visible options
   * @default 8
   */
  readonly visibleCount?: number;
}

export function InteractiveSelect({
  title,
  options,
  onSelect,
  onCancel,
  visibleCount = 8,
}: InteractiveSelectProps): React.JSX.Element {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const handleSelect = useCallback(() => {
    const option = options[focusedIndex];
    if (option) {
      onSelect(option.value);
    }
  }, [focusedIndex, options, onSelect]);

  useInput((input, key) => {
    // ESC to cancel
    if (key.escape) {
      onCancel();
      return;
    }

    // Enter to select
    if (key.return) {
      handleSelect();
      return;
    }

    // Number keys 1-9 to select by index
    const num = parseInt(input, 10);
    if (num >= 1 && num <= 9 && num <= options.length) {
      onSelect(options[num - 1]!.value);
      return;
    }

    // Arrow keys for navigation
    if (key.downArrow || input === "j") {
      setFocusedIndex((prev) => {
        const next = Math.min(prev + 1, options.length - 1);
        // Adjust scroll if needed
        if (next >= scrollOffset + visibleCount) {
          setScrollOffset(next - visibleCount + 1);
        }
        return next;
      });
    }

    if (key.upArrow || input === "k") {
      setFocusedIndex((prev) => {
        const next = Math.max(prev - 1, 0);
        // Adjust scroll if needed
        if (next < scrollOffset) {
          setScrollOffset(next);
        }
        return next;
      });
    }
  });

  const visibleOptions = options.slice(scrollOffset, scrollOffset + visibleCount);
  const showUpArrow = scrollOffset > 0;
  const showDownArrow = scrollOffset + visibleCount < options.length;

  return (
    <Box flexDirection="column">
      {title && (
        <Box marginBottom={1}>
          <Text bold>{title}</Text>
        </Box>
      )}

      {showUpArrow && (
        <Box>
          <Text color="gray">  {chalk.dim("↑ more")}</Text>
        </Box>
      )}

      {visibleOptions.map((option, idx) => {
        const actualIndex = scrollOffset + idx;
        const isFocused = actualIndex === focusedIndex;
        const displayNumber = actualIndex < 9 ? `${actualIndex + 1}` : " ";

        return (
          <Box key={option.value}>
            <Text color="gray">{displayNumber}. </Text>
            <Text
              color={isFocused ? "cyan" : undefined}
              bold={isFocused}
              inverse={isFocused}
            >
              {isFocused ? ` ${option.label} ` : option.label}
            </Text>
            {option.hint && (
              <Text color="gray"> {option.hint}</Text>
            )}
          </Box>
        );
      })}

      {showDownArrow && (
        <Box>
          <Text color="gray">  {chalk.dim("↓ more")}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">
          Use arrows/j/k to navigate, Enter or 1-9 to select, ESC to cancel
        </Text>
      </Box>
    </Box>
  );
}

