# Boot page design prototype

Three standalone startup-page directions based on ChatGPT's design plan: A · wide split, B · status poster, and C · diagnostic margin. This folder is an isolated review artifact; it does not change or ship with the Electron boot page.

Open `index.html` directly. In PowerShell from the repository root:

```powershell
Start-Process .\prototypes\boot-page\index.html
```

Use the bottom switcher or `?variant=a`, `?variant=b`, and `?variant=c`. Append `&presentation=clean` to hide the prototype controls for a full-viewport presentation; this does not change the layout dimensions. Shareable examples include:

- `?variant=a&presentation=clean`
- `?variant=b&state=error&presentation=clean`
- `?variant=c&state=scheduled&theme=dark&presentation=clean`

The state selector includes sample startup, known/unknown plugin loading, settled failure, scheduled restart, and restarting fixtures. Theme and reduced-motion controls are also available. When the operating system forces reduced motion, the control reports `系统开启` and cannot claim motion is enabled. All fixture data is illustrative, and the displayed actions are not connected to the application.
