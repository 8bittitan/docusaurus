import {useEffect} from 'react';

interface SidepanelShortcuts {
  'Ctrl/Cmd+I'?: boolean;
}

type UseSidepanelKeyboardEventsProps = {
  onClose: () => void;
  onOpen: () => void;
  isEnabled: boolean;
  isOpen: boolean;
  keyboardShortcuts?: SidepanelShortcuts;
};

export function useAlgoliaSidepanelKeyboardEvents({
  onClose,
  onOpen,
  isOpen,
  isEnabled,
  keyboardShortcuts,
}: UseSidepanelKeyboardEventsProps): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (!isEnabled) {
        return;
      }

      if (isOpen && e.code === 'Escape') {
        onClose();
        return;
      }

      const cmdIEnabled = keyboardShortcuts?.['Ctrl/Cmd+I'] !== false;

      if (!cmdIEnabled) {
        return;
      }

      const isCmdI = e.key?.toLowerCase() === 'i' && (e.metaKey || e.ctrlKey);

      if (isCmdI) {
        e.preventDefault();

        if (isOpen) {
          onClose();
        } else {
          onOpen();
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);

    return (): void => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose, onOpen, keyboardShortcuts, isEnabled]);
}
