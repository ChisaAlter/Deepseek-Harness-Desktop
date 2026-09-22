import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type ReactElement,
  type RefObject,
  type SetStateAction,
} from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { GitHubSearchItem } from "@chisacode/protocol/messages";

import type { ComposerAttachment, UserComposerAttachment } from "@/attachments/types";
import {
  findGithubItemByOption,
  isAttachmentSelectedForGithubItem,
  toggleGithubAttachmentFromPicker,
} from "@/composer/actions";
import { formatGithubItemLabel } from "@/composer/attachment-queue-model";
import { GithubPickerOption } from "@/composer/attachment-queue-renderers";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { useGithubSearchQuery, type GitHubSearchClient } from "@/git/use-github-search-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useComposerGithubAutoAttach } from "./auto-attach";

interface UseComposerGithubPickerInput {
  client: GitHubSearchClient | null;
  serverId: string;
  cwd: string;
  text: string;
  attachments: UserComposerAttachment[];
  selectedAttachments: readonly ComposerAttachment[];
  setAttachments: Dispatch<SetStateAction<UserComposerAttachment[]>>;
  isConnected: boolean;
  anchorRef: RefObject<View | null>;
}

interface ComposerGithubPickerResult {
  githubPicker: ReactElement;
  markGithubAttachmentRemoved: (attachment: ComposerAttachment | undefined) => void;
  openGithubPicker: () => void;
}

function noop() {}

function resolveGithubSearchEnabled(open: boolean, isConnected: boolean, cwd: string): boolean {
  return open && isConnected && cwd.trim().length > 0;
}

export function useComposerGithubPicker(
  input: UseComposerGithubPickerInput,
): ComposerGithubPickerResult {
  const {
    client,
    serverId,
    cwd,
    text,
    attachments,
    selectedAttachments,
    setAttachments,
    isConnected,
    anchorRef,
  } = input;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const checkoutStatusQuery = useCheckoutStatusQuery({ serverId, cwd });
  const { markGithubAttachmentRemoved } = useComposerGithubAutoAttach({
    text,
    remoteUrl: checkoutStatusQuery.status?.remoteUrl ?? null,
    attachments,
    client,
    isConnected,
    serverId,
    cwd,
    setAttachments,
  });

  const trimmedSearchQuery = searchQuery.trim();
  const searchResultsQuery = useGithubSearchQuery({
    client,
    serverId,
    cwd,
    query: trimmedSearchQuery,
    enabled: resolveGithubSearchEnabled(open, isConnected, cwd),
  });
  const searchItemsRaw = searchResultsQuery.data?.items;
  const searchItems = useMemo(() => searchItemsRaw ?? [], [searchItemsRaw]);
  const searchOptions = useMemo<ComboboxOption[]>(
    () =>
      searchItems.map((item) => ({
        id: `${item.kind}:${item.number}`,
        label: formatGithubItemLabel(item),
        description: trimmedSearchQuery,
      })),
    [searchItems, trimmedSearchQuery],
  );

  const openGithubPicker = useCallback(() => {
    setOpen(true);
  }, []);
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchQuery("");
    }
  }, []);
  const handleToggleGithubItem = useCallback(
    (item: GitHubSearchItem) => {
      const nextAttachments = toggleGithubAttachmentFromPicker({
        current: attachments,
        item,
        markGithubAttachmentRemoved,
      });
      setAttachments(nextAttachments);
      setOpen(false);
      setSearchQuery("");
    },
    [attachments, markGithubAttachmentRemoved, setAttachments],
  );
  const renderOption = useCallback(
    ({ option, active }: { option: ComboboxOption; selected: boolean; active: boolean }) => {
      const item = findGithubItemByOption(searchItems, option.id);
      if (!item) {
        return <View key={option.id} />;
      }
      return (
        <GithubPickerOption
          key={option.id}
          testID={`composer-github-option-${option.id}`}
          label={option.label}
          selected={isAttachmentSelectedForGithubItem(selectedAttachments, item)}
          active={active}
          item={item}
          onToggle={handleToggleGithubItem}
        />
      );
    },
    [handleToggleGithubItem, searchItems, selectedAttachments],
  );

  const emptyText = searchResultsQuery.isFetching
    ? t("workspace.searching")
    : t("composer.noGithubResults");
  const githubPicker = (
    <Combobox
      options={searchOptions}
      value=""
      onSelect={noop}
      keepOpenOnSelect
      searchable
      searchPlaceholder={t("composer.searchIssuesAndPrs")}
      title={t("composer.addIssueOrPr")}
      open={open}
      onOpenChange={handleOpenChange}
      onSearchQueryChange={setSearchQuery}
      desktopPlacement="top-start"
      anchorRef={anchorRef}
      emptyText={emptyText}
      renderOption={renderOption}
    />
  );

  return { githubPicker, markGithubAttachmentRemoved, openGithubPicker };
}
