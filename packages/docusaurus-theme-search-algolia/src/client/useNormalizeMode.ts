import type {DocSearchAskAi} from '@docsearch/react';

type NormalizeModeProps = {
  mode: 'modal' | 'sidepanel' | 'hybrid';
  askAi?: DocSearchAskAi;
};

type UseNormalizeModeResult = {
  isSidepanel: boolean;
  isModal: boolean;
};

export function useNormalizeMode({
  mode,
  askAi,
}: NormalizeModeProps): UseNormalizeModeResult {
  let isModal = true;
  let isSidepanel = false;

  if (mode === 'sidepanel') {
    isModal = false;
  }

  if (mode !== 'modal' && typeof askAi !== 'undefined') {
    isSidepanel = true;
  }

  return {
    isModal,
    isSidepanel,
  };
}
