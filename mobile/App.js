import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <Text style={styles.kicker}>手机远程</Text>
      <Text style={styles.title}>请用 Android 安装包或系统浏览器打开桌面二维码</Text>
      <Text style={styles.lead}>
        原生客户端在 mobile/android（Kotlin Compose）。浏览器继续走独立 SPA。不要用 WebView 套官方四栏页。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f6f7',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  kicker: {
    color: '#81858c',
    fontSize: 13,
  },
  title: {
    color: '#0f1115',
    fontSize: 22,
    fontWeight: '600',
  },
  lead: {
    color: '#61656b',
    fontSize: 15,
    lineHeight: 22,
  },
});
