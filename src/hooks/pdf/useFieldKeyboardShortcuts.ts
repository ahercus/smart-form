import { useEffect } from "react";

interface UseFieldKeyboardShortcutsProps {
  activeFieldId: string | null;
  onDelete: (fieldId: string) => void;
  onStartEditing: (fieldId: string) => void;
  onStopEditing: () => void;
  onSwitchToTypeMode?: () => void;
}

// Check if a key is a printable character (triggers text input)
function isPrintableKey(e: KeyboardEvent): boolean {
  // Single character keys that aren't special
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    return true;
  }
  return false;
}

export function useFieldKeyboardShortcuts({
  activeFieldId,
  onDelete,
  onStartEditing,
  onStopEditing,
  onSwitchToTypeMode,
}: UseFieldKeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if we're focused on an input/textarea
      const activeElement = document.activeElement;
      const isInputFocused =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement;

      if (!activeFieldId) return;

      // Delete key removes the selected field (when not editing)
      if ((e.key === "Delete" || e.key === "Backspace") && !isInputFocused) {
        e.preventDefault();
        onStopEditing();
        onDelete(activeFieldId);
        return;
      }

      // Enter key starts editing the selected field (when not already editing)
      if (e.key === "Enter" && !isInputFocused) {
        e.preventDefault();
        onSwitchToTypeMode?.();
        onStartEditing(activeFieldId);
        return;
      }

      // Escape key deselects the field
      if (e.key === "Escape") {
        e.preventDefault();
        onStopEditing();
        return;
      }

      // Printable character - switch to type mode and start editing
      if (isPrintableKey(e) && !isInputFocused) {
        // Don't prevent default - let the character be typed
        onSwitchToTypeMode?.();
        onStartEditing(activeFieldId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeFieldId, onDelete, onStartEditing, onStopEditing, onSwitchToTypeMode]);
}
