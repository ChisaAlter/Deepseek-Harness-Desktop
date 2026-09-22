import { useMemo } from "react";
import { Image } from "react-native";

interface ChisaCodeLogoProps {
  size?: number;
  color?: string;
}

export function ChisaCodeLogo({ size = 64 }: ChisaCodeLogoProps) {
  const style = useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: size * 0.22,
    }),
    [size],
  );

  return (
    <Image source={require("../../../assets/images/icon.png")} style={style} resizeMode="contain" />
  );
}
