//! Integracao com o Windows: menu do botao direito e inicio automatico.
//!
//! As chaves ficam em HKCU, e nao em HKLM, de proposito: assim a integracao
//! nao pede elevacao e some junto com o perfil do usuario. Nada e escrito fora
//! de `Software\Classes\SystemFileAssociations`, que e o lugar previsto para
//! acrescentar acoes a um tipo de arquivo sem sequestrar o programa padrao.

use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const SEM_JANELA: u32 = 0x0800_0000;

const RAIZ: &str = r"HKCU\Software\Classes\SystemFileAssociations";
const CHAVE_DE_INICIO: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const NOME_NO_INICIO: &str = "PDF.GreenCodes";

struct Acao {
    extensao: &'static str,
    chave: &'static str,
    rotulo: &'static str,
    varios: bool,
}

const ACOES: &[Acao] = &[
    Acao { extensao: ".pdf", chave: "GreenPdfAbrir", rotulo: "Abrir no PDF.GreenCodes", varios: false },
    Acao { extensao: ".pdf", chave: "GreenPdfJuntar", rotulo: "Juntar com o PDF.GreenCodes", varios: true },
    Acao { extensao: ".jpg", chave: "GreenPdfImagem", rotulo: "Transformar em PDF", varios: true },
    Acao { extensao: ".jpeg", chave: "GreenPdfImagem", rotulo: "Transformar em PDF", varios: true },
    Acao { extensao: ".png", chave: "GreenPdfImagem", rotulo: "Transformar em PDF", varios: true },
];

fn caminho_da_chave(acao: &Acao) -> String {
    format!(r"{RAIZ}\{}\shell\{}", acao.extensao, acao.chave)
}

fn reg(argumentos: &[&str]) -> bool {
    let mut comando = Command::new("reg");
    comando.args(argumentos);
    #[cfg(windows)]
    comando.creation_flags(SEM_JANELA);
    comando
        .output()
        .map(|saida| saida.status.success())
        .unwrap_or(false)
}

fn executavel() -> PathBuf {
    std::env::current_exe().unwrap_or_else(|_| PathBuf::from("PDF.GreenCodes.exe"))
}

/// O que o `reg query` responde, em texto.
fn consultar(argumentos: &[&str]) -> String {
    let mut comando = Command::new("reg");
    comando.args(argumentos);
    #[cfg(windows)]
    comando.creation_flags(SEM_JANELA);
    comando
        .output()
        .map(|saida| String::from_utf8_lossy(&saida.stdout).to_lowercase())
        .unwrap_or_default()
}

/// Reaponta para este executavel o que estiver ligado.
///
/// Quem vinha da versao em Electron tinha o menu do botao direito e o inicio
/// automatico apontando para o executavel antigo, que o instalador novo
/// remove: o "Abrir no PDF.GreenCodes" passava a dar erro do Windows, e o
/// computador ligava sem o programa na bandeja. So mexe no que ja estava
/// ligado - quem nunca ligou continua sem nada no registro.
pub fn atualizar_caminhos() {
    if !cfg!(windows) {
        return;
    }
    let exe = executavel().to_string_lossy().to_lowercase();

    let comando_do_menu = format!(r"{}\command", caminho_da_chave(&ACOES[0]));
    if menu_ativo() && !consultar(&["query", &comando_do_menu, "/ve"]).contains(&exe) {
        ativar_menu();
    }
    if inicio_ativo() && !consultar(&["query", CHAVE_DE_INICIO, "/v", NOME_NO_INICIO]).contains(&exe) {
        definir_inicio(true);
    }
}

/// Ja esta registrado? Basta a primeira chave responder.
pub fn menu_ativo() -> bool {
    if !cfg!(windows) {
        return false;
    }
    reg(&["query", &caminho_da_chave(&ACOES[0]), "/ve"])
}

pub fn definir_menu(ligado: bool) -> bool {
    if !cfg!(windows) {
        return false;
    }
    if ligado {
        ativar_menu()
    } else {
        desativar_menu()
    }
}

fn ativar_menu() -> bool {
    let exe = executavel();
    let exe = exe.to_string_lossy().to_string();
    let icone = format!("{exe},0");

    for acao in ACOES {
        let chave = caminho_da_chave(acao);
        reg(&["add", &chave, "/ve", "/d", acao.rotulo, "/f"]);
        reg(&["add", &chave, "/v", "Icon", "/d", &icone, "/f"]);

        // MultiSelectModel=Player entrega todos os selecionados numa chamada
        // so, em vez de abrir uma janela por arquivo.
        if acao.varios {
            reg(&["add", &chave, "/v", "MultiSelectModel", "/d", "Player", "/f"]);
        }

        let comando = format!("\"{exe}\" \"%1\"");
        reg(&["add", &format!(r"{chave}\command"), "/ve", "/d", &comando, "/f"]);
    }
    true
}

fn desativar_menu() -> bool {
    let mut vistas: Vec<String> = Vec::new();
    for acao in ACOES {
        let chave = caminho_da_chave(acao);
        if vistas.contains(&chave) {
            continue;
        }
        vistas.push(chave.clone());
        reg(&["delete", &chave, "/f"]);
    }
    true
}

/// Abre junto com o Windows, escondido na bandeja.
pub fn inicio_ativo() -> bool {
    if !cfg!(windows) {
        return false;
    }
    reg(&["query", CHAVE_DE_INICIO, "/v", NOME_NO_INICIO])
}

pub fn definir_inicio(ligado: bool) -> bool {
    if !cfg!(windows) {
        return false;
    }
    if ligado {
        let exe = executavel();
        // `--oculto` deixa o aplicativo comecar sem janela: quem liga o inicio
        // automatico quer o programa pronto, e nao uma janela na cara ao ligar
        // o computador.
        let valor = format!("\"{}\" --oculto", exe.to_string_lossy());
        reg(&["add", CHAVE_DE_INICIO, "/v", NOME_NO_INICIO, "/d", &valor, "/f"])
    } else {
        reg(&["delete", CHAVE_DE_INICIO, "/v", NOME_NO_INICIO, "/f"])
    }
}

/// Abre as Preferencias de Impressao do proprio driver.
///
/// Tipo e espessura de papel (comum, fotografico, cartao, etiqueta) nao passam
/// pela API do Windows: ficam no DEVMODE privado do driver, e so a janela dele
/// mexe nisso. O que a pessoa marcar ali vira o padrao daquela impressora, e o
/// nosso envio silencioso sai com esse padrao.
pub fn preferencias_da_impressora(impressora: &str) -> Result<(), String> {
    if impressora.trim().is_empty() {
        return Err("escolha uma impressora primeiro".into());
    }

    // Solto e sem esperar: a janela e modal do Windows, e travar o aplicativo
    // atras dela deixaria a fila congelada.
    let mut comando = Command::new("rundll32.exe");
    comando.args(["printui.dll,PrintUIEntry", "/e", "/n", impressora]);
    #[cfg(windows)]
    comando.creation_flags(SEM_JANELA);
    comando
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("nao consegui abrir as preferencias: {e}"))
}
