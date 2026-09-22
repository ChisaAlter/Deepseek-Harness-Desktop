import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Check, ChevronDown, ChevronRight, Eye, EyeOff, Link2 } from "lucide-react-native";
import type { HostProfile } from "@/types/host-connection";
import { useHosts, useHostMutations } from "@/runtime/host-runtime";
import {
  parseConnectionUri,
  serializeConnectionUri,
  serializeConnectionUriForStorage,
} from "@/utils/daemon-endpoints";
import { DaemonConnectionTestError } from "@/utils/test-daemon-connection";
import { AdaptiveModalSheet, AdaptiveTextInput, type SheetHeader } from "./adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";

// Lucide icons only accept `color` (a non-style prop), so wrap each one with
// `withUnistyles` and feed the theme-reactive color through `uniProps`. Only the
// icon node re-renders on theme changes — the surrounding tree does not.
const ThemedLink2 = withUnistyles(Link2);
const ThemedCheck = withUnistyles(Check);

const whiteColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.white,
});
const accentForegroundColorMapping = (theme: Theme) => ({
  color: theme.colors.accentForeground,
});
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const FLEX_ONE_STYLE = { flex: 1 } as const;
const DEFAULT_DIRECT_HOST = "localhost";
const DEFAULT_DIRECT_PORT = "6767";

interface DirectConnectionDraft {
  host: string;
  port: string;
  useTls: boolean;
  password: string;
}

interface PreparedDirectConnection {
  uri: string;
  endpoint: string;
  useTls: boolean;
  password?: string;
}

interface DirectConnectionCopy {
  hostRequired: string;
  invalidPort: string;
  noMoreDetails: string;
  unableToConnectTitle: (endpoint: string) => string;
  incorrectPassword: string;
  passwordRequired: string;
  timedOut: string;
  connectionRefused: string;
  hostNotFound: string;
  hostUnreachable: string;
  tlsError: string;
  unableToConnect: string;
}

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    // Soft form chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
  },
  // Soft form field: quiet surface, soft radius.
  input: {
    backgroundColor: theme.colors.surface0,
    borderRadius: 12,
    height: 48,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: 0,
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
    textAlignVertical: "center",
    includeFontPadding: false,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  portRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  hostField: {
    flex: 1,
    minWidth: 0,
  },
  portField: {
    width: 112,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  passwordInput: {
    flex: 1,
    minWidth: 0,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    alignSelf: "flex-start",
    paddingVertical: theme.spacing[1],
  },
  advancedText: {
    color: theme.colors.foreground,
    // Soft form chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: 12.5,
    lineHeight: 16,
  },
}));

function isIpv6Host(host: string): boolean {
  return host.includes(":") && !host.startsWith("[") && !host.endsWith("]");
}

function buildConnectionUriFromDraft(
  draft: DirectConnectionDraft,
  copy: Pick<DirectConnectionCopy, "hostRequired" | "invalidPort">,
): string {
  const host = draft.host.trim();
  const port = Number(draft.port.trim());
  if (!host) {
    throw new Error(copy.hostRequired);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(copy.invalidPort);
  }

  return serializeConnectionUriForStorage({
    host,
    port,
    isIpv6: isIpv6Host(host),
    useTls: draft.useTls,
    ...(draft.password ? { password: draft.password } : {}),
  });
}

function prepareDirectConnection(
  draft: DirectConnectionDraft,
  copy: Pick<DirectConnectionCopy, "hostRequired" | "invalidPort">,
): PreparedDirectConnection {
  const parsed = parseConnectionUri(buildConnectionUriFromDraft(draft, copy));
  const endpoint = parsed.isIpv6
    ? `[${parsed.host}]:${parsed.port}`
    : `${parsed.host}:${parsed.port}`;

  return {
    uri: serializeConnectionUri(parsed),
    endpoint,
    useTls: parsed.useTls,
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

function draftFromConnectionUri(uri: string): DirectConnectionDraft {
  const parsed = parseConnectionUri(uri);
  return {
    host: parsed.host,
    port: String(parsed.port),
    useTls: parsed.useTls,
    password: parsed.password ?? "",
  };
}

function normalizeTransportMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  return trimmed;
}

function formatTechnicalTransportDetails(
  details: (string | null)[],
  noMoreDetails: string,
): string | null {
  const unique = Array.from(
    new Set(
      details
        .map((value) => normalizeTransportMessage(value))
        .filter((value): value is string => Boolean(value))
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

  if (unique.length === 0) return null;

  const allGeneric = unique.every((value) => {
    const lower = value.toLowerCase();
    return lower === "transport error" || lower === "transport closed";
  });

  if (allGeneric) {
    return `${unique[0]}（${noMoreDetails}）`;
  }

  return unique.join(" — ");
}

function buildConnectionFailureCopy(
  endpoint: string,
  error: unknown,
  copy: DirectConnectionCopy,
): { title: string; detail: string | null; raw: string | null } {
  const title = copy.unableToConnectTitle(endpoint);

  const raw = (() => {
    if (error instanceof DaemonConnectionTestError) {
      return (
        formatTechnicalTransportDetails([error.reason, error.lastError], copy.noMoreDetails) ??
        normalizeTransportMessage(error.message)
      );
    }
    if (error instanceof Error) {
      return normalizeTransportMessage(error.message);
    }
    return null;
  })();

  const rawLower = raw?.toLowerCase() ?? "";
  let detail: string | null = null;

  if (raw === "Incorrect password" || raw === "Password required") {
    detail = raw === "Incorrect password" ? copy.incorrectPassword : copy.passwordRequired;
  } else if (rawLower.includes("timed out")) {
    detail = copy.timedOut;
  } else if (
    rawLower.includes("econnrefused") ||
    rawLower.includes("connection refused") ||
    rawLower.includes("err_connection_refused")
  ) {
    detail = copy.connectionRefused;
  } else if (rawLower.includes("enotfound") || rawLower.includes("not found")) {
    detail = copy.hostNotFound;
  } else if (rawLower.includes("ehostunreach") || rawLower.includes("host is unreachable")) {
    detail = copy.hostUnreachable;
  } else if (
    rawLower.includes("certificate") ||
    rawLower.includes("tls") ||
    rawLower.includes("ssl")
  ) {
    detail = copy.tlsError;
  } else {
    detail = copy.unableToConnect;
  }

  return { title, detail, raw };
}

export interface AddHostModalProps {
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

export function AddHostModal({ visible, onClose, onCancel, onSaved }: AddHostModalProps) {
  const { t } = useTranslation();
  const daemons = useHosts();
  const { probeAndUpsertDirectConnection } = useHostMutations();
  const isMobile = useIsCompactFormFactor();

  const hostRef = useRef(DEFAULT_DIRECT_HOST);
  const portRef = useRef(DEFAULT_DIRECT_PORT);
  const passwordRef = useRef("");
  const hostInputRef = useRef<TextInput>(null);
  const portInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [useTls, setUseTls] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [advancedUri, setAdvancedUri] = useState("");
  const [inputResetKey, bumpInputResetKey] = useReducer((key: number) => key + 1, 0);
  const header = useMemo<SheetHeader>(() => ({ title: t("host.directConnection") }), [t]);
  const connectionCopy = useMemo<DirectConnectionCopy>(
    () => ({
      hostRequired: t("host.hostRequired"),
      invalidPort: t("host.invalidPort"),
      noMoreDetails: t("host.noMoreDetails"),
      unableToConnectTitle: (endpoint) => t("host.unableToConnectTitle", { endpoint }),
      incorrectPassword: t("host.incorrectPassword"),
      passwordRequired: t("host.passwordRequired"),
      timedOut: t("host.timedOut"),
      connectionRefused: t("host.connectionRefused"),
      hostNotFound: t("host.hostNotFound"),
      hostUnreachable: t("host.hostUnreachable"),
      tlsError: t("host.tlsError"),
      unableToConnect: t("host.unableToConnect"),
    }),
    [t],
  );

  const clearInput = useCallback(() => {
    hostRef.current = DEFAULT_DIRECT_HOST;
    portRef.current = DEFAULT_DIRECT_PORT;
    passwordRef.current = "";
    hostInputRef.current?.clear();
    portInputRef.current?.clear();
    passwordInputRef.current?.clear();
    setUseTls(false);
    setIsPasswordVisible(false);
    setIsAdvancedOpen(false);
    setAdvancedUri("");
    bumpInputResetKey();
  }, []);

  const connectIcon = useMemo(() => <ThemedLink2 size={16} uniProps={whiteColorMapping} />, []);
  const hostFieldStyle = useMemo(() => [styles.field, styles.hostField], []);
  const portFieldStyle = useMemo(() => [styles.field, styles.portField], []);
  const checkboxStyle = useMemo(
    () => [styles.checkbox, useTls ? styles.checkboxChecked : null],
    [useTls],
  );
  const passwordInputStyle = useMemo(() => [styles.input, styles.passwordInput], []);
  const useTlsAccessibilityState = useMemo(
    () => ({ checked: useTls, disabled: isSaving }),
    [isSaving, useTls],
  );

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

    let connection: PreparedDirectConnection;
    try {
      connection = prepareDirectConnection(
        {
          host: hostRef.current,
          port: portRef.current,
          useTls,
          password: passwordRef.current,
        },
        connectionCopy,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : t("host.invalidConnectionInfo");
      setErrorMessage(message);
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage("");

      const { profile, serverId, hostname } = await probeAndUpsertDirectConnection({
        endpoint: connection.endpoint,
        useTls: connection.useTls,
        ...(connection.password ? { password: connection.password } : {}),
      });
      const isNewHost = !daemons.some((daemon) => daemon.serverId === serverId);

      onSaved?.({ profile, serverId, hostname, isNewHost });
      handleClose();
    } catch (error) {
      const {
        title,
        detail,
        raw: rawDetail,
      } = buildConnectionFailureCopy(connection.uri, error, connectionCopy);
      let combined: string;
      if (rawDetail && detail && rawDetail !== detail) {
        combined = `${title}\n${detail}\n${t("host.details", { detail: rawDetail })}`;
      } else if (detail) {
        combined = `${title}\n${detail}`;
      } else {
        combined = title;
      }
      setErrorMessage(combined);
      if (!isMobile) {
        Alert.alert(t("host.connectionFailed"), combined);
      }
    } finally {
      setIsSaving(false);
    }
  }, [
    daemons,
    connectionCopy,
    handleClose,
    isMobile,
    isSaving,
    onSaved,
    probeAndUpsertDirectConnection,
    t,
    useTls,
  ]);

  const handleSubmitEditing = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const handleToggleUseTls = useCallback(() => {
    if (isSaving) return;
    setUseTls((current) => !current);
  }, [isSaving]);

  const handleTogglePasswordVisibility = useCallback(() => {
    setIsPasswordVisible((current) => !current);
  }, []);

  const handleHostChange = useCallback((next: string) => {
    hostRef.current = next;
  }, []);

  const handlePortChange = useCallback((next: string) => {
    portRef.current = next;
  }, []);

  const handlePasswordChange = useCallback((next: string) => {
    passwordRef.current = next;
  }, []);

  const handleToggleAdvanced = useCallback(() => {
    if (!isAdvancedOpen) {
      try {
        setAdvancedUri(
          buildConnectionUriFromDraft(
            {
              host: hostRef.current,
              port: portRef.current,
              useTls,
              password: passwordRef.current,
            },
            connectionCopy,
          ),
        );
      } catch {
        setAdvancedUri("");
      }
      setErrorMessage("");
      setIsAdvancedOpen(true);
      return;
    }

    try {
      const next = draftFromConnectionUri(advancedUri);
      hostRef.current = next.host;
      portRef.current = next.port;
      passwordRef.current = next.password;
      setUseTls(next.useTls);
      setErrorMessage("");
      bumpInputResetKey();
    } catch {
      setErrorMessage("");
    }
    setIsAdvancedOpen(false);
  }, [advancedUri, connectionCopy, isAdvancedOpen, useTls]);

  const AdvancedIcon = isAdvancedOpen ? ChevronDown : ChevronRight;
  const PasswordIcon = isPasswordVisible ? EyeOff : Eye;
  // Icons are dynamic per state; wrap with `withUnistyles` so the theme-reactive
  // `color` flows through `uniProps` without a `useUnistyles` hook call.
  const ThemedAdvancedIcon = useMemo(() => withUnistyles(AdvancedIcon), [AdvancedIcon]);
  const ThemedPasswordIcon = useMemo(() => withUnistyles(PasswordIcon), [PasswordIcon]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="add-host-modal"
    >
      <Text style={styles.helper}>{t("host.enterServerAddress")}</Text>

      <View style={styles.portRow}>
        <View style={hostFieldStyle}>
          <Text style={styles.label}>{t("host.host")}</Text>
          <AdaptiveTextInput
            ref={hostInputRef}
            testID="direct-host-input"
            nativeID="direct-host-input"
            accessibilityLabel={t("host.host")}
            initialValue={hostRef.current}
            resetKey={`direct-host-${inputResetKey}`}
            onChangeText={handleHostChange}
            placeholder="localhost"
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!isSaving}
            returnKeyType="next"
          />
        </View>
        <View style={portFieldStyle}>
          <Text style={styles.label}>{t("host.port")}</Text>
          <AdaptiveTextInput
            ref={portInputRef}
            testID="direct-port-input"
            nativeID="direct-port-input"
            accessibilityLabel={t("host.port")}
            initialValue={portRef.current}
            resetKey={`direct-port-${inputResetKey}`}
            onChangeText={handlePortChange}
            placeholder="6767"
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            editable={!isSaving}
            returnKeyType="done"
            onSubmitEditing={handleSubmitEditing}
          />
        </View>
      </View>

      <Pressable
        style={styles.checkboxRow}
        onPress={handleToggleUseTls}
        disabled={isSaving}
        accessibilityRole="checkbox"
        accessibilityLabel={t("host.useSsl")}
        accessibilityState={useTlsAccessibilityState}
        testID="direct-ssl-toggle"
      >
        <View style={checkboxStyle}>
          {useTls ? (
            <View testID="direct-ssl-toggle-checked">
              <ThemedCheck size={14} uniProps={accentForegroundColorMapping} />
            </View>
          ) : null}
        </View>
        <Text style={styles.label}>{t("host.useSsl")}</Text>
      </Pressable>

      <View style={styles.field}>
        <Text style={styles.label}>{t("host.password")}</Text>
        <View style={styles.passwordRow}>
          <AdaptiveTextInput
            ref={passwordInputRef}
            testID="direct-password-input"
            nativeID="direct-password-input"
            accessibilityLabel={t("host.password")}
            initialValue={passwordRef.current}
            resetKey={`direct-password-${inputResetKey}`}
            onChangeText={handlePasswordChange}
            placeholder={t("host.optional")}
            style={passwordInputStyle}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!isPasswordVisible}
            editable={!isSaving}
            returnKeyType="done"
            onSubmitEditing={handleSubmitEditing}
          />
          <Pressable
            style={styles.iconButton}
            onPress={handleTogglePasswordVisibility}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel={isPasswordVisible ? t("host.hidePassword") : t("host.showPassword")}
            testID="direct-password-visibility-toggle"
          >
            <ThemedPasswordIcon size={18} uniProps={foregroundMutedColorMapping} />
          </Pressable>
        </View>
      </View>

      <View style={styles.field}>
        <Pressable
          style={styles.advancedToggle}
          onPress={handleToggleAdvanced}
          disabled={isSaving}
          accessibilityRole="button"
          accessibilityLabel={
            isAdvancedOpen ? t("host.hideAdvancedOptions") : t("host.showAdvancedOptions")
          }
          testID="direct-host-advanced-toggle"
        >
          <ThemedAdvancedIcon size={16} uniProps={foregroundMutedColorMapping} />
          <Text style={styles.advancedText}>{t("host.advanced")}</Text>
        </Pressable>
        {isAdvancedOpen ? (
          <AdaptiveTextInput
            testID="direct-host-uri-input"
            nativeID="direct-host-uri-input"
            accessibilityLabel={t("host.connectionUri")}
            initialValue={advancedUri}
            resetKey={`direct-host-uri-${inputResetKey}`}
            onChangeText={setAdvancedUri}
            placeholder="tcp://localhost:6767?ssl=true"
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!isSaving}
            returnKeyType="done"
            onSubmitEditing={handleToggleAdvanced}
          />
        ) : null}
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}
          variant="secondary"
          onPress={handleCancel}
          disabled={isSaving}
        >
          {t("common.cancel")}
        </Button>
        <Button
          style={FLEX_ONE_STYLE}
          variant="default"
          onPress={handleSavePress}
          disabled={isSaving}
          leftIcon={connectIcon}
          testID="direct-host-submit"
        >
          {isSaving ? t("host.connecting") : t("host.connect")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}
