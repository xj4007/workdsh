# 三云Buddy user guide

[中文](user-guide.md)

## Install and launch

Download a release with actual installer assets from [GitHub Releases](https://github.com/techflag/workdsh/releases). Use the x64 Setup or Portable package on Windows. On macOS, choose the Apple Silicon (arm64) or Intel (x64) DMG for your computer. The installer includes Electron, Node, and a pinned DSH Profile; ordinary users do not need to install Node.js or Python.

Choose personal or enterprise use when the application starts. Both modes run the official DSH service from that Profile locally and open its page in the application window. Library, experts, skills and MCP/connectors ship by default; the enterprise account plugin ships with the runtime and activates only after enterprise login. Projects, 三云Buddy Office, activity, collaboration and notifications require explicit external plugin installation. See the [Desktop connection guide](DESKTOP-PERSONAL-ENTERPRISE.md) for enterprise login and managed company packages. Closing the Windows window exits the application; macOS follows its normal window lifecycle. The current carrier does not include the former tray or multi-Profile selector described in older documentation; for updates it offers only a new-version notice and a manual check, not automatic download or installation.

## Data and plugins

Runtime data lives in a DSH home under the local application-data directory. The installer contains the pinned Profile dependencies; the Electron carrier does not install a second DSH npm tree into `app.asar`. Models and external tools may access the network according to user configuration.

三云Buddy features update with the downloaded release. To add third-party plugins through official DSH mechanisms, follow the upstream documentation for the pinned version and inspect the active Profile. Do not use the former `desktopProfiles` or `desktopPnpm` APIs. SkillHub and dshmarket provide third-party catalogs; check provenance, licenses, dependencies and version compatibility before installing. Manage library content and explicitly installed project features through their product UI.

## Updates and troubleshooting

At launch, Desktop asks the update server whether a newer version exists (this needs network access; a failed check never blocks normal use), and the same version is not announced again on every start. When a newer version exists, a dialog offers Download update, which opens the installer download link in your default browser; run that installer to upgrade in place, and your account, settings, and workspace data are kept. You can also check manually from the Tools → Check for updates… menu, or download the installer for your platform directly from [Releases](https://github.com/techflag/workdsh/releases). Desktop does not download or install updates silently.

If no window appears, check that the installer matches your OS architecture, restart, and record the error. Include the OS, 三云Buddy version, reproduction steps, and error in a [GitHub Issue](https://github.com/techflag/workdsh/issues). See the [architecture](architecture.en.md) for development and packaging boundaries.
