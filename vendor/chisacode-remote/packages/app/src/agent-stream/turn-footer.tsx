import React, { memo, useCallback, useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { StreamItem } from "@/types/stream";
import {
  collectAssistantTurnContentForStreamRenderStrategy,
  type StreamStrategy,
} from "./strategy";
import { AssistantTurnFooter } from "@/components/message";
import type { TurnFooterHost } from "./layout";
import { RunningTurnFooter } from "./running-turn-footer";
import { getTurnFooterStreamItemWrapperStyle } from "./turn-footer-layout";

export type TurnContentStrategy = StreamStrategy;

export const TurnFooter = memo(function TurnFooter({
  isRunning,
  inFlightTurnStartedAt,
  host,
  strategy,
}: {
  isRunning: boolean;
  inFlightTurnStartedAt: Date | null;
  host: TurnFooterHost | null;
  strategy: TurnContentStrategy;
}) {
  if (isRunning) {
    return (
      <TurnFooterRow>
        <RunningTurnFooter inFlightTurnStartedAt={inFlightTurnStartedAt} />
      </TurnFooterRow>
    );
  }
  if (!host) {
    return null;
  }
  return (
    <CompletedTurnFooterRow strategy={strategy} items={host.items} startIndex={host.startIndex} />
  );
});

export const CompletedTurnFooterRow = memo(function CompletedTurnFooterRow({
  strategy,
  items,
  startIndex,
}: {
  strategy: TurnContentStrategy;
  items: StreamItem[];
  startIndex: number;
}) {
  return (
    <TurnFooterRow>
      <CompletedTurnFooter strategy={strategy} items={items} startIndex={startIndex} />
    </TurnFooterRow>
  );
});

function CompletedTurnFooter({
  strategy,
  items,
  startIndex,
}: {
  strategy: TurnContentStrategy;
  items: StreamItem[];
  startIndex: number;
}) {
  const getContent = useCallback(
    () =>
      collectAssistantTurnContentForStreamRenderStrategy({
        strategy,
        items,
        startIndex,
      }),
    [strategy, items, startIndex],
  );
  return (
    <View style={stylesheet.turnFooterSlot}>
      <AssistantTurnFooter getContent={getContent} />
    </View>
  );
}

function TurnFooterRow({ children }: { children: ReactNode }) {
  const rowStyle = useMemo(() => [stylesheet.streamItemWrapper, stylesheet.turnFooterRow], []);
  return <View style={rowStyle}>{children}</View>;
}

const stylesheet = StyleSheet.create((theme) => ({
  streamItemWrapper: getTurnFooterStreamItemWrapperStyle(theme.spacing[2]),
  turnFooterRow: {
    marginTop: theme.spacing[4],
  },
  turnFooterSlot: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    minHeight: 24,
    paddingBottom: theme.spacing[6],
  },
}));
