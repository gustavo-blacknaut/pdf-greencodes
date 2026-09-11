; Ganchos do instalador do Tauri.
;
; Tira a versao antiga, feita em Electron, antes de instalar esta. As duas
; moram em pastas diferentes, entao sem isto a maquina da loja ficava com dois
; "PDF.GreenCodes" instalados, dois atalhos e o menu do botao direito
; apontando para o velho.
;
; A chave e a mesma em toda maquina: o electron-builder gera o identificador
; a partir do appId (br.com.greencodes.pdf), e nao ao acaso.

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\471b61d6-db8f-5de8-aa78-e3633a94fece" "QuietUninstallString"
  ${If} $0 != ""
    DetailPrint "Removendo a versao antiga do PDF.GreenCodes (Electron)..."
    ExecWait '$0'
    ; O desinstalador do NSIS se copia para a pasta temporaria e devolve na
    ; hora; a espera deixa ele terminar antes de os atalhos novos nascerem.
    Sleep 4000
  ${EndIf}
!macroend
