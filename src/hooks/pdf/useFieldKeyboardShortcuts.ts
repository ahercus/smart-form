import { useEffect } from "react";

interface UseFieldKeyboardShortcutsProps {
  activeFieldId: string | null;
  onDelete: (fieldId: string) => void;
  onStartEditing: (fieldId: string) => void;
  onStopEditing: () => void;
}

export function useFieldKeyboardShortcuts({
  activeFieldId,
  onDelete,
  onStartEditing,
  onStopEditing,
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
      }

      // Enter key starts editing the selected field (when not already editing)
      if (e.key === "Enter" && !isInputFocused) {
        e.preventDefault();
        onStartEditing(activeFieldId);
      }

      // Escape key deselects the field
      if (e.key === "Escape") {
        e.preventDefault();
        onStopEditing();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeFieldId, onDelete, onStartEditing, onStopEditing]);
}
