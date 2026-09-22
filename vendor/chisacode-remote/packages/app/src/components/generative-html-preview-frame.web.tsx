import React from "react";

interface GenerativeHtmlPreviewFrameProps {
  documentHtml: string;
  title: string;
}

export function GenerativeHtmlPreviewFrame({
  documentHtml,
  title,
}: GenerativeHtmlPreviewFrameProps) {
  return React.createElement("iframe", {
    srcDoc: documentHtml,
    title,
    sandbox: "allow-scripts",
    loading: "lazy",
    style: {
      width: "100%",
      height: "100%",
      border: 0,
      display: "block",
      background: "transparent",
    },
  });
}
