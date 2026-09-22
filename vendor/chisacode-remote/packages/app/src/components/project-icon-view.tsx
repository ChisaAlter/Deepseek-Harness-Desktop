import { useMemo } from "react";
import {
  Image,
  type ImageStyle,
  type StyleProp,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { deriveProjectIconColor } from "@/utils/project-icon-color";

const styles = StyleSheet.create((theme) => ({
  fallbackText: {
    color: theme.colors.accentForeground,
  },
}));

export function ProjectIconView({
  iconDataUri,
  initial,
  projectKey,
  imageStyle,
  fallbackStyle,
  textStyle,
}: {
  iconDataUri: string | null;
  initial: string;
  projectKey: string;
  imageStyle: StyleProp<ImageStyle>;
  fallbackStyle: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
}) {
  const imageSource = useMemo(() => ({ uri: iconDataUri ?? "" }), [iconDataUri]);
  const fallbackStyles = useMemo(
    () => [fallbackStyle, { backgroundColor: deriveProjectIconColor(projectKey) }],
    [fallbackStyle, projectKey],
  );
  const textStyles = useMemo(() => [textStyle, styles.fallbackText], [textStyle]);

  if (iconDataUri) {
    return <Image source={imageSource} style={imageStyle} />;
  }
  return (
    <View style={fallbackStyles}>
      <Text style={textStyles}>{initial}</Text>
    </View>
  );
}
