; ClipVault installer hooks, inserted into Tauri's NSIS template.
;
; Startup: the app reads this Run value as the source of truth for
; Settings > Launch on Windows startup, and starts in the tray via --minimized.

!define CLIPVAULT_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define CLIPVAULT_RUN_VALUE "ClipVault"

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $0 HKCU "${CLIPVAULT_RUN_KEY}" "${CLIPVAULT_RUN_VALUE}"
  ${If} $0 != ""
    ; Already enabled: keep it pointed at this install.
    WriteRegStr HKCU "${CLIPVAULT_RUN_KEY}" "${CLIPVAULT_RUN_VALUE}" '"$INSTDIR\${MAINBINARYNAME}.exe" --minimized'
  ${ElseIf} $UpdateMode <> 1
  ${AndIf} $PassiveMode <> 1
  ${AndIfNot} ${Silent}
    ${If} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION "Start ClipVault automatically when you sign in to Windows?$\r$\n$\r$\nClipVault only saves your clipboard history while it's running. It starts quietly in the system tray, and you can change this later in Settings." /SD IDNO IDYES`
      WriteRegStr HKCU "${CLIPVAULT_RUN_KEY}" "${CLIPVAULT_RUN_VALUE}" '"$INSTDIR\${MAINBINARYNAME}.exe" --minimized'
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Tauri's "Delete the application data" option only clears the bundle-id folders.
  ; ClipVault's encrypted database and key live under %LOCALAPPDATA%\ClipVault\ClipVault.
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RMDir /r "$LOCALAPPDATA\ClipVault\ClipVault"
    RMDir "$LOCALAPPDATA\ClipVault"
  ${EndIf}
!macroend
