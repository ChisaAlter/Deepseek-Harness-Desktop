import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Link } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import type { HostProfile } from "@/types/host-connection";
import { useHosts, useHostMutations } from "@/runtime/host-runtime";
import { decodeOfferFragmentPayload, normalizeHostPort } from "@/utils/daemon-endpoints";
import { connectToDaemon } from "@/utils/test-daemon-connection";
import { ConnectionOfferSchema } from "@chisacode/protocol/connection-offer";
import { AdaptiveModalSheet, AdaptiveTextInput, type SheetHeader } from "./adaptive-modal-sheet";
import { Button } from "@/components/ui/button";

const FLEX_ONE_STYLE = { flex: 1 } as const;

// Icon color mappings for withUnistyles-wrapped lucide icons, so the
// theme-reactive `color` flows through `uniProps` without `useUnistyles()`.
const ThemedLink = withUnistyles(Link);
const paletteWhiteColorMapping = (theme: Theme) => ({ color: theme.colors.palette.white });

const styles = StyleSheet.create((theme) => ({
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    // Soft pair modal body: 12.5.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    backgroundColor: theme.colors.surface0,
    borderRadius: 12,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: 12.5,
    lineHeight: 16,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
}));

export interface PairLinkModalProps {
  visible: boolean;
  onClose: () => void;
  onCancel?: () => void;
  onSaved?: (result: {
    profile: HostProfile;
    serverId: string;
    hostname: string | null;
    isNewHost: boolean;
  }) => void;
}

export function PairLinkModal({ visible, onClose, onCancel, onSaved }: PairLinkModalProps) {
  const { t } = useTranslation();
  const daemons = useHosts();
  const { upsertConnectionFromOfferUrl: upsertDaemonFromOfferUrl } = useHostMutations();
  const isMobile = useIsCompactFormFactor();

  const offerUrlRef = useRef("");
  const inputRef = useRef<TextInput>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.pasteLink") }), [t]);

  const clearInput = useCallback(() => {
    offerUrlRef.current = "";
    inputRef.current?.clear();
  }, []);

  const pairIcon = useMemo(() => <ThemedLink size={16} uniProps={paletteWhiteColorMapping} />, []);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    clearInput();
    setErrorMessage("");
    onClose();
  }, [isSaving, clearInput, onClose]);

  const handleCancel = useCallback(() => {
    if (isSaving) return;
    clearInput();
    setErrorMessage("");
    (onCancel ?? onClose)();
  }, [isSaving, clearInput, onCancel, onClose]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    const raw = offerUrlRef.current.trim();
    if (!raw) {
      setErrorMessage(t("pairing.emptyLink"));
      return;
    }
    if (!raw.includes("#offer=")) {
      setErrorMessage(t("pairing.missingOffer"));
      return;
    }

    const parsedOffer = (() => {
      try {
        const idx = raw.indexOf("#offer=");
        const encoded = raw.slice(idx + "#offer=".length).trim();
        if (!encoded) {
          throw new Error(t("pairing.emptyOffer"));
        }
        const payload = decodeOfferFragmentPayload(encoded);
        return ConnectionOfferSchema.parse(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : t("pairing.invalidLink");
        setErrorMessage(message);
        if (!isMobile) {
          Alert.alert(t("pairing.pairFailed"), message);
        }
        return null;
      }
    })();

    if (!parsedOffer) {
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage("");

      const { client, hostname } = await connectToDaemon(
        {
          id: "probe",
          type: "relay",
          relayEndpoint: normalizeHostPort(parsedOffer.relay.endpoint),
          useTls: parsedOffer.relay.useTls,
          daemonPublicKeyB64: parsedOffer.daemonPublicKeyB64,
        },
        { serverId: parsedOffer.serverId },
      );
      await client.close().catch(() => undefined);

      const isNewHost = !daemons.some((daemon) => daemon.serverId === parsedOffer.serverId);
      const profile = await upsertDaemonFromOfferUrl(raw, hostname ?? undefined);
      onSaved?.({ profile, serverId: parsedOffer.serverId, hostname, isNewHost });
      handleClose();
    } catch (error) {
      const errorText = error instanceof Error ? error.message : t("pairing.unableToPairHost");
      const message = /relay device auth|upgrade and re-pair|4401|device auth required/i.test(
        errorText,
      )
        ? t("settings.hostPage.pairDevice.upgradeRequiredBody")
        : errorText;
      setErrorMessage(message);
      if (!isMobile) {
        Alert.alert(t("pairing.pairFailed"), message);
      }
    } finally {
      setIsSaving(false);
    }
  }, [daemons, handleClose, isMobile, isSaving, onSaved, t, upsertDaemonFromOfferUrl]);

  const handleChangeOfferUrl = useCallback((next: string) => {
    offerUrlRef.current = next;
  }, []);

  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="pair-link-modal"
    >
      <Text style={styles.helper}>{t("pairing.pasteLinkHelper")}</Text>

      <View style={styles.field}>
        <Text style={styles.label}>{t("pairing.pairingLink")}</Text>
        <AdaptiveTextInput
          ref={inputRef}
          testID="pair-link-input"
          nativeID="pair-link-input"
          accessibilityLabel={t("pairing.pairingLink")}
          onChangeText={handleChangeOfferUrl}
          placeholder="https://app.chisacode.sh/#offer=..."
          style={styles.input}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}
          variant="secondary"
          onPress={handleCancel}
          disabled={isSaving}
          testID="pair-link-cancel"
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
        >
          {t("common.cancel")}
        </Button>
        <Button
          style={FLEX_ONE_STYLE}
          variant="default"
          onPress={handleSavePress}
          disabled={isSaving}
          testID="pair-link-submit"
          accessibilityRole="button"
          accessibilityLabel={t("pairing.pair")}
          leftIcon={pairIcon}
        >
          {isSaving ? t("pairing.pairingAction") : t("pairing.pair")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}
