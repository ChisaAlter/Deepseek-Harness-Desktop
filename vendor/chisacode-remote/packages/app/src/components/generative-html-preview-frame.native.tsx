import React, { useCallback, useMemo } from "react";
import { WebView } from "react-native-webview";
import type { OnShouldStartLoadWithRequest } from "react-native-webview/lib/WebViewTypes";

interface GenerativeHtmlPreviewFrameProps {
  documentHtml: string;
  title: string;
}

const ORIGIN_WHITELIST = ["about:blank"];
const WEBVIEW_STYLE = { flex: 1, backgroundColor: "transparent" };

export function GenerativeHtmlPreviewFrame({
  documentHtml,
  title: _title,
}: GenerativeHtmlPreviewFrameProps) {
  const source = useMemo(() => ({ html: documentHtml, baseUrl: "about:blank" }), [documentHtml]);
  const handleShouldStartLoad = useCallback<OnShouldStartLoadWithRequest>((request) => {
    return request.url === "about:blank" || request.url.startsWith("about:blank#");
  }, []);

  return (
    <WebView
      source={source}
      originWhitelist={ORIGIN_WHITELIST}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      mixedContentMode="never"
      onShouldStartLoadWithRequest={handleShouldStartLoad}
      style={WEBVIEW_STYLE}
    />
  );
}
