import React from "react";
function svgElement(tagName) {
  return function SvgElement({ children, testID, ...props }) {
    return React.createElement(tagName, { ...props, "data-testid": testID }, children);
  };
}
const Svg = svgElement("svg");
export default Svg;
export const Circle = svgElement("circle");
export const Defs = svgElement("defs");
export const G = svgElement("g");
export const Line = svgElement("line");
export const LinearGradient = svgElement("linearGradient");
export const Path = svgElement("path");
export const Polygon = svgElement("polygon");
export const Rect = svgElement("rect");
export const Stop = svgElement("stop");
export const SvgCss = svgElement("svg");
export const SvgCssUri = svgElement("svg");
export const SvgFromXml = svgElement("svg");
export const SvgUri = svgElement("svg");
export const SvgXml = svgElement("svg");
export const Use = svgElement("use");
