declare module "unzip-crx-3" {
  function unzipCrx(crxPath: string, outputDir: string): Promise<void>;
  export default unzipCrx;
}
