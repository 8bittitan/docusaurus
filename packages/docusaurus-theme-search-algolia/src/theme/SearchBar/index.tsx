/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {createPortal, flushSync} from 'react-dom';
import {DocSearchButton} from '@docsearch/react/button';
import {SidepanelButton} from '@docsearch/react/sidepanel';
import {useDocSearchKeyboardEvents} from '@docsearch/react/useDocSearchKeyboardEvents';
import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';
import {useHistory} from '@docusaurus/router';
import {isRegexpStringMatch} from '@docusaurus/theme-common';
import {
  useAlgoliaContextualFacetFilters,
  useSearchResultUrlProcessor,
  useAlgoliaAskAi,
  mergeFacetFilters,
  useSearchLinkCreator,
  useNormalizeMode,
  useAlgoliaSidepanelKeyboardEvents,
} from '@docusaurus/theme-search-algolia/client';
import Translate from '@docusaurus/Translate';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {
  type InternalDocSearchHit,
  type DocSearchModal as DocSearchModalType,
  type DocSearchAskAiModal as DocSearchAskAiModalType,
  type DocSearchModalProps,
  type StoredDocSearchHit,
  type DocSearchTransformClient,
  type DocSearchHit,
  type DocSearchAskAi,
  type DocSearchAIProps,
} from '@docsearch/react';
import {
  type Sidepanel as SidepanelType,
  type SidepanelButtonProps,
  type SidepanelProps,
} from '@docsearch/react/sidepanel';
import translations from '@theme/SearchTranslations';

import type {AutocompleteState} from '@algolia/autocomplete-core';
import type {FacetFilters} from 'algoliasearch/lite';

type DocSearchProps = Omit<
  DocSearchModalProps,
  'onClose' | 'initialScrollY'
> & {
  contextualSearch?: string;
  externalUrlRegex?: string;
  searchPagePath: boolean | string;
  askAi?: DocSearchAskAi;
  mode?: 'modal' | 'sidepanel' | 'hybrid';
  sidepanel?: {
    button?: SidepanelButtonProps;
    panel?: SidepanelProps;
  };
};

type ModalKind = 'askai' | 'search';
type ModalComponentType =
  | typeof DocSearchModalType
  | typeof DocSearchAskAiModalType;

const loadedModules: Partial<Record<ModalKind, ModalComponentType>> = {};

let Sidepanel: typeof SidepanelType | null = null;

function importDocSearchModalIfNeeded(kind: ModalKind) {
  if (loadedModules[kind]) {
    return Promise.resolve();
  }

  const modalImport =
    kind === 'askai'
      ? import('@docsearch/react/askaiModal').then((m) => m.DocSearchAskAiModal)
      : import('@docsearch/react/modal').then((m) => m.DocSearchModal);

  return Promise.all([
    modalImport,
    import('@docsearch/react/style'),
    import('./styles.css'),
  ]).then(([Modal]) => {
    loadedModules[kind] = Modal;
  });
}

async function importSidepanelIfNeeded() {
  if (Sidepanel) {
    return;
  }

  const [{Sidepanel: SidepanelComp}] = await Promise.all([
    import('@docsearch/react/sidepanel'),
    import('@docsearch/react/style'),
    import('@docsearch/react/style/sidepanel'),
  ]);

  await import('./styles.css');
  Sidepanel = SidepanelComp;
}

function useNavigator({
  externalUrlRegex,
}: Pick<DocSearchProps, 'externalUrlRegex'>) {
  const history = useHistory();
  const [navigator] = useState<DocSearchModalProps['navigator']>(() => {
    return {
      navigate(params) {
        // Algolia results could contain URL's from other domains which cannot
        // be served through history and should navigate with window.location
        if (isRegexpStringMatch(externalUrlRegex, params.itemUrl)) {
          window.location.href = params.itemUrl;
        } else {
          history.push(params.itemUrl);
        }
      },
    };
  });
  return navigator;
}

function useTransformSearchClient(): DocSearchModalProps['transformSearchClient'] {
  const {
    siteMetadata: {docusaurusVersion},
  } = useDocusaurusContext();
  return useCallback(
    (searchClient: DocSearchTransformClient) => {
      searchClient.addAlgoliaAgent('docusaurus', docusaurusVersion);
      return searchClient;
    },
    [docusaurusVersion],
  );
}

function useTransformItems(props: Pick<DocSearchProps, 'transformItems'>) {
  const processSearchResultUrl = useSearchResultUrlProcessor();
  const [transformItems] = useState<DocSearchModalProps['transformItems']>(
    () => {
      return (items: DocSearchHit[]) =>
        props.transformItems
          ? // Custom transformItems
            props.transformItems(items)
          : // Default transformItems
            items.map((item) => ({
              ...item,
              url: processSearchResultUrl(item.url),
            }));
    },
  );
  return transformItems;
}

function useResultsFooterComponent({
  closeModal,
}: {
  closeModal: () => void;
}): DocSearchProps['resultsFooterComponent'] {
  return useMemo(
    () =>
      // eslint-disable-next-line react/display-name
      ({state}) => <ResultsFooter state={state} onClose={closeModal} />,
    [closeModal],
  );
}

function Hit({
  hit,
  children,
}: {
  hit: InternalDocSearchHit | StoredDocSearchHit;
  children: ReactNode;
}) {
  return <Link to={hit.url}>{children}</Link>;
}

type ResultsFooterProps = {
  state: AutocompleteState<InternalDocSearchHit>;
  onClose: () => void;
};

function ResultsFooter({state, onClose}: ResultsFooterProps) {
  const createSearchLink = useSearchLinkCreator();

  return (
    <Link to={createSearchLink(state.query)} onClick={onClose}>
      <Translate
        id="theme.SearchBar.seeAll"
        values={{count: state.context.nbHits}}>
        {'See all {count} results'}
      </Translate>
    </Link>
  );
}

// Normalizes `indices` with configured and merged search parameters
function useNormalizeIndices({
  contextualSearch,
  ...props
}: DocSearchProps): DocSearchProps['indices'] {
  const contextualSearchFacetFilters = useAlgoliaContextualFacetFilters();
  const indices: DocSearchProps['indices'] = [];

  for (const index of props.indices) {
    const normalizedIndex =
      typeof index === 'string' ? {name: index, searchParameters: {}} : index;
    const configFacetFilters: FacetFilters =
      normalizedIndex.searchParameters?.facetFilters ?? [];

    const facetFilters: FacetFilters = contextualSearch
      ? // Merge contextual search filters with config filters
        mergeFacetFilters(contextualSearchFacetFilters, configFacetFilters)
      : // ... or use config facetFilters
        configFacetFilters;

    // We let users override default searchParameters if they want to
    indices.push({
      name: normalizedIndex.name,
      searchParameters: {
        ...normalizedIndex.searchParameters,
        facetFilters,
      },
    });
  }

  return indices;
}

type InitialMessage = {
  query: string;
  messageId?: string;
  suggestedQuestionId?: string;
};

function DocSearch({
  externalUrlRegex,
  mode = 'modal',
  ...props
}: DocSearchProps) {
  const navigator = useNavigator({externalUrlRegex});
  const indices = useNormalizeIndices({...props});
  const transformItems = useTransformItems(props);
  const transformSearchClient = useTransformSearchClient();
  const {isModal, isSidepanel} = useNormalizeMode({mode, askAi: props.askAi});

  const searchContainer = useRef<HTMLDivElement | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
  const sidepanelButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState<string | undefined>(
    undefined,
  );
  const [isSidepanelOpen, setIsSidepanelOpen] = useState(false);
  const [initialMessage, setInitialMessage] = useState<
    InitialMessage | undefined
  >(undefined);

  const {
    isAskAiActive,
    currentPlaceholder,
    onAskAiToggle,
    extraAskAiProps,
    canHandleAskAi,
    askAi,
  } = useAlgoliaAskAi({...props});

  const prepareSearchContainer = useCallback(() => {
    if (!searchContainer.current) {
      const divElement = document.createElement('div');
      searchContainer.current = divElement;
      document.body.insertBefore(divElement, document.body.firstChild);
    }
  }, []);

  const modalKind: ModalKind = canHandleAskAi ? 'askai' : 'search';

  const loadModal = useCallback(() => {
    if (!isModal) {
      return Promise.resolve();
    }

    return importDocSearchModalIfNeeded(modalKind);
  }, [modalKind, isModal]);

  const openModal = useCallback(() => {
    if (!isModal) {
      return;
    }

    prepareSearchContainer();
    loadModal().then(() => {
      flushSync(() => {
        setIsSidepanelOpen(false);
        setIsOpen(true);
      });
    });
  }, [prepareSearchContainer, loadModal, isModal]);

  const closeModal = useCallback(() => {
    setIsOpen(false);
    searchButtonRef.current?.focus();
    setInitialQuery(undefined);
    onAskAiToggle(false);
  }, [onAskAiToggle]);

  const loadSidepanel = () => {
    return importSidepanelIfNeeded();
  };

  const openSidepanel = useCallback(() => {
    if (!isSidepanel) {
      return;
    }

    loadSidepanel().then(() => {
      flushSync(() => {
        setIsOpen(false);
        setIsSidepanelOpen(true);
      });
    });
  }, [isSidepanel]);

  const closeSidepanel = useCallback(() => {
    setIsSidepanelOpen(false);
    sidepanelButtonRef.current?.focus();
    onAskAiToggle(false);
  }, [onAskAiToggle]);

  const interceptAskAiEvent: DocSearchAIProps['interceptAskAiEvent'] =
    useCallback(
      (message) => {
        if (!isSidepanel) {
          return false;
        }

        loadSidepanel().then(() => {
          flushSync(() => {
            setInitialMessage(message);
            setIsOpen(false);
            setIsSidepanelOpen(true);
          });
        });

        return true;
      },
      [isSidepanel],
    );

  const handleInput = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'f' && (event.metaKey || event.ctrlKey)) {
        // ignore browser's ctrl+f
        return;
      }
      // prevents duplicate key insertion in the modal input
      event.preventDefault();
      setInitialQuery(event.key);
      openModal();
    },
    [openModal],
  );

  const resultsFooterComponent = useResultsFooterComponent({closeModal});

  useDocSearchKeyboardEvents({
    isOpen,
    onOpen: openModal,
    onClose: closeModal,
    onInput: handleInput,
    searchButtonRef,
    isAskAiActive: isAskAiActive ?? false,
    onAskAiToggle: onAskAiToggle ?? (() => {}),
    keyboardShortcuts: {
      '/': isModal,
      'Ctrl/Cmd+K': isModal,
    },
  });

  useAlgoliaSidepanelKeyboardEvents({
    onClose: closeSidepanel,
    onOpen: openSidepanel,
    isOpen: isSidepanelOpen,
    isEnabled: isSidepanel,
  });

  const DocSearchModal = loadedModules[modalKind];

  const isFloatingSidepanelButton =
    (props.sidepanel?.button?.variant ?? 'floating') === 'floating';

  const sidepanelButton = (
    <SidepanelButton
      ref={sidepanelButtonRef}
      onTouchStart={loadSidepanel}
      onFocus={loadSidepanel}
      onMouseOver={loadSidepanel}
      onClick={openSidepanel}
      {...props.sidepanel?.button}
      {...(isFloatingSidepanelButton ? {tabIndex: 0} : {})}
    />
  );

  return (
    <>
      <Head>
        {/* This hints the browser that the website will load data from Algolia,
        and allows it to preconnect to the DocSearch cluster. It makes the first
        query faster, especially on mobile. */}
        <link
          rel="preconnect"
          href={`https://${props.appId}-dsn.algolia.net`}
          crossOrigin="anonymous"
        />
      </Head>

      {isModal && (
        <DocSearchButton
          onTouchStart={loadModal}
          onFocus={loadModal}
          onMouseOver={loadModal}
          onClick={openModal}
          ref={searchButtonRef}
          translations={props.translations?.button ?? translations.button}
        />
      )}

      {isModal &&
        isOpen &&
        DocSearchModal &&
        // TODO fix this
        // eslint-disable-next-line react-hooks/refs
        searchContainer.current &&
        createPortal(
          <DocSearchModal
            onClose={closeModal}
            initialScrollY={window.scrollY}
            initialQuery={initialQuery}
            navigator={navigator}
            transformItems={transformItems}
            hitComponent={Hit}
            transformSearchClient={transformSearchClient}
            {...(props.searchPagePath && {
              resultsFooterComponent,
            })}
            placeholder={currentPlaceholder}
            {...(props as any)}
            translations={props.translations?.modal ?? translations.modal}
            indices={indices}
            {...extraAskAiProps}
            interceptAskAiEvent={interceptAskAiEvent}
          />,

          // TODO fix this
          // eslint-disable-next-line react-hooks/refs
          searchContainer.current,
        )}

      {isSidepanel && askAi && (
        <>
          {isFloatingSidepanelButton
            ? createPortal(sidepanelButton, document.body)
            : sidepanelButton}
        </>
      )}

      {isSidepanel &&
        askAi &&
        Sidepanel &&
        createPortal(
          <Sidepanel
            {...askAi}
            apiKey={askAi.apiKey ?? props.apiKey}
            appId={askAi.appId ?? props.appId}
            isOpen={isSidepanelOpen}
            onOpen={openSidepanel}
            onClose={closeSidepanel}
            initialMessage={initialMessage}
            keyboardShortcuts={{
              'Ctrl/Cmd+I': false,
            }}
            {...props.sidepanel?.panel}
          />,
          document.body,
        )}
    </>
  );
}

export default function SearchBar(props: Partial<DocSearchProps>): ReactNode {
  const {siteConfig} = useDocusaurusContext();

  const docSearchProps: DocSearchProps = {
    ...(siteConfig.themeConfig.algolia as DocSearchProps),
    // Let props override theme config
    // See https://github.com/facebook/docusaurus/pull/11581
    ...props,
  };

  return <DocSearch {...docSearchProps} />;
}
