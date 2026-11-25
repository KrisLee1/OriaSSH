; Register an available handler. Windows owns the user's default selection.
!ifndef ORIA_VNC_SCHEME
  !define ORIA_VNC_SCHEME "vnc"
!endif
; Product names change, while a user-selected VNC ProgID is persistent.
!macro OriaVncClass
  !if "${BUNDLEID}" == "com.oria-tunnel"
    !define ORIA_VNC_CLASS "OriaTunnel.VNC"
  !else
    !define ORIA_VNC_CLASS "${PRODUCTNAME}.VNC"
  !endif
!macroend

!macro RenameOriaShortcut DIR
  !insertmacro IsShortcutTarget "${DIR}\OriaTunnel.lnk" "$INSTDIR\oria-tunnel.exe"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "${DIR}\OriaTunnel.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    ${IfNot} ${FileExists} "${DIR}\${PRODUCTNAME}.lnk"
      Rename "${DIR}\OriaTunnel.lnk" "${DIR}\${PRODUCTNAME}.lnk"
    ${Else}
      !insertmacro IsShortcutTarget "${DIR}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $0
      ${If} $0 = 1
        Delete "${DIR}\OriaTunnel.lnk"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro OriaVncClass
  !if "${BUNDLEID}" == "com.oria-tunnel"
    Push $0
    !insertmacro RenameOriaShortcut "$SMPROGRAMS"
    !insertmacro RenameOriaShortcut "$DESKTOP"
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "OriaTunnel"
    ${If} $0 == '"$INSTDIR\oria-tunnel.exe" --background'
      ClearErrors
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}" '"$INSTDIR\${MAINBINARYNAME}.exe" --background'
      ${IfNot} ${Errors}
        DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "OriaTunnel"
      ${EndIf}
    ${EndIf}
    ReadRegStr $0 SHCTX "Software\RegisteredApplications" "OriaTunnel"
    ${If} $0 == "Software\OriaTunnel\Capabilities"
      DeleteRegValue SHCTX "Software\RegisteredApplications" "OriaTunnel"
    ${EndIf}
    Pop $0
  !endif
  ; Settings lists link types only if the scheme itself is a URL protocol.
  ; This shared marker has no open command and can serve other VNC clients.
  Push $0
  ClearErrors
  ReadRegStr $0 HKCR "${ORIA_VNC_SCHEME}" "URL Protocol"
  ${If} ${Errors}
    WriteRegStr SHCTX "Software\Classes\${ORIA_VNC_SCHEME}" "URL Protocol" ""
  ${EndIf}
  Pop $0
  WriteRegStr SHCTX "Software\Classes\${ORIA_VNC_CLASS}" "" "${PRODUCTNAME} VNC"
  WriteRegStr SHCTX "Software\Classes\${ORIA_VNC_CLASS}" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\${ORIA_VNC_CLASS}\DefaultIcon" "" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\${ORIA_VNC_CLASS}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationDescription" "${PRODUCTNAME} VNC"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationIcon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\URLAssociations" "${ORIA_VNC_SCHEME}" "${ORIA_VNC_CLASS}"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\${PRODUCTNAME}\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; An older copy may be uninstalled after another directory took ownership.
  Push $0
  ReadRegStr $0 SHCTX "Software\Classes\${ORIA_VNC_CLASS}\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
    ReadRegStr $0 SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
    ${If} $0 == "Software\${PRODUCTNAME}\Capabilities"
      DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
    ${EndIf}
    DeleteRegKey SHCTX "Software\${PRODUCTNAME}\Capabilities"
    DeleteRegKey /ifempty SHCTX "Software\${PRODUCTNAME}"
    DeleteRegKey SHCTX "Software\Classes\${ORIA_VNC_CLASS}"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
  ${EndIf}
  Pop $0
!macroend
