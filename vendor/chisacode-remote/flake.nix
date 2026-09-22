{
  description = "ChisaCode - self-hosted daemon for AI coding agents";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      pkgsFor = system: import nixpkgs { inherit system; };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          chisacode = pkgs.callPackage ./nix/package.nix { };
          isLinux = nixpkgs.lib.elem system [
            "x86_64-linux"
            "aarch64-linux"
          ];
        in
        {
          default = chisacode;
          chisacode = chisacode;
        }
        // nixpkgs.lib.optionalAttrs isLinux {
          desktop = pkgs.callPackage ./nix/desktop-package.nix { inherit chisacode; };
        }
      );

      nixosModules.default = self.nixosModules.chisacode;
      nixosModules.chisacode =
        { pkgs, lib, ... }:
        {
          imports = [ ./nix/module.nix ];
          services.chisacode.package = lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };

      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.python3
            ];
          };
        }
      );
    };
}
