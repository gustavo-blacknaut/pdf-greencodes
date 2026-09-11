//! Impressao pelo auxiliar em C#.
//!
//! O Electron imprimia pelo `webContents.print()` do Chromium. O Tauri usa o
//! WebView do sistema, que nao expoe nada equivalente: nao da para escolher
//! impressora, copias nem tamanho de papel por ali.
//!
//! Entao a impressao passa pelo `impressora.exe`, que ja existia neste
//! repositorio e fala direto com a API de impressao do Windows.
//!
//! A divisao de trabalho mudou junto, e e ela que conserta a fatura A4 saindo
//! do tamanho de uma A5 no meio da folha: a interface monta a **folha inteira**
//! como imagem, ja na proporcao exata do papel escolhido e com escala,
//! deslocamento, espelho e marcas dentro dela. Aqui so se diz ao Windows qual
//! e o papel. Sem duas medidas para negociar, nao sobra o que discordar.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::motor::recursos;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const SEM_JANELA: u32 = 0x0800_0000;

/// Identificador de cada papel no driver do Windows.
///
/// Numeros, e nao nomes, porque e o que o `DEVMODE` carrega: o nome que o
/// driver mostra e traduzido e varia de fabricante para fabricante.
fn codigo_do_papel(nome: &str) -> i32 {
    match nome {
        "A3" => 8,
        "A5" => 11,
        "Legal" => 5,
        "Letter" => 1,
        "Tabloid" => 3,
        _ => 9,
    }
}

#[derive(Default)]
pub struct Sessoes {
    abertas: Mutex<HashMap<String, PathBuf>>,
}

/// A pasta de uma sessao que ja saiu da lista para ser enviada.
///
/// Apaga as folhas quando sai de cena, seja qual for o caminho - enviada,
/// cancelada no dialogo do driver ou com erro -, sem precisar lembrar de
/// limpar em cada `return`.
struct Tomada(PathBuf);

impl Drop for Tomada {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[derive(Serialize)]
pub struct Preparada {
    pub ok: bool,
    pub id: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpcoesDeImpressao {
    pub impressora: Option<String>,
    pub copias: Option<u32>,
    pub colorido: Option<bool>,
    pub paisagem: Option<bool>,
    /// "simplex", "shortEdge" ou "longEdge".
    pub duplex: Option<String>,
    /// O nome do papel na tela: A3, A4, A5, Legal, Letter, Tabloid.
    pub papel: Option<String>,
    /// Destino quando a impressora e virtual, para nao abrir janela de salvar.
    pub arquivo: Option<String>,
    /// Abre a janela do driver antes de enviar, onde moram tipo e espessura
    /// de papel. O que for escolhido ali vem de volta como DEVMODE e e o que
    /// o envio usa.
    pub usar_dialogo: Option<bool>,
}

impl Sessoes {
    pub fn preparar(&self) -> Result<Preparada, String> {
        let id = format!(
            "greencodes-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos()
        );
        let pasta = std::env::temp_dir().join(&id);
        fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
        self.abertas
            .lock()
            .map_err(|_| "sessoes travadas")?
            .insert(id.clone(), pasta);
        Ok(Preparada { ok: true, id })
    }

    /// Grava uma folha ja montada.
    ///
    /// Uma de cada vez de proposito: um documento de 55 folhas em 300 DPI
    /// passa de 50 MB, e segurar tudo antes de enviar derruba a aba.
    pub fn pagina(&self, id: &str, indice: u32, bytes: Vec<u8>) -> Result<(), String> {
        let pasta = self.pasta(id)?;
        let arquivo = pasta.join(format!("{indice:04}.jpg"));
        fs::write(arquivo, bytes).map_err(|e| format!("nao consegui gravar a folha: {e}"))
    }

    pub fn descartar(&self, id: &str) -> Result<(), String> {
        if let Some(pasta) = self
            .abertas
            .lock()
            .map_err(|_| "sessoes travadas")?
            .remove(id)
        {
            let _ = fs::remove_dir_all(pasta);
        }
        Ok(())
    }

    /// Na saida do aplicativo, nao deixa lixo em %TEMP%.
    pub fn limpar_tudo(&self) {
        let Ok(mut abertas) = self.abertas.lock() else {
            return;
        };
        for (_, pasta) in abertas.drain() {
            let _ = fs::remove_dir_all(pasta);
        }
    }

    fn pasta(&self, id: &str) -> Result<PathBuf, String> {
        self.abertas
            .lock()
            .map_err(|_| "sessoes travadas")?
            .get(id)
            .cloned()
            .ok_or_else(|| "sessao de impressao nao encontrada".into())
    }

    /// Tira a sessao da lista para envia-la: dali em diante, ela e so de quem
    /// a tirou.
    ///
    /// E isto que impede a tiragem em dobro. O Tauri reenvia o comando pelo
    /// canal reserva quando o pedido cai no meio - trocar de tela enquanto a
    /// impressora trabalha basta -, e a mesma sessao chegava duas vezes. A
    /// segunda agora nao acha nada para mandar.
    fn tomar(&self, id: &str) -> Result<Tomada, String> {
        self.abertas
            .lock()
            .map_err(|_| "sessoes travadas")?
            .remove(id)
            .map(Tomada)
            .ok_or_else(|| "esta impressao ja foi enviada".into())
    }

    pub fn enviar(
        &self,
        app: &AppHandle,
        id: &str,
        opcoes: OpcoesDeImpressao,
        nome: Option<String>,
    ) -> Result<Value, String> {
        let tomada = self.tomar(id)?;
        let pasta = &tomada.0;

        let mut folhas: Vec<PathBuf> = fs::read_dir(pasta)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("jpg"))
            .collect();
        // Pelo numero, e nao pelo texto: como texto, "10000" vem antes de
        // "9999" e a folha dez mil sairia no meio do livro.
        folhas.sort_by_key(|p| numero_da_folha(p));

        if folhas.is_empty() {
            return Err("nenhuma folha para imprimir".into());
        }

        let impressora = match opcoes.impressora.clone() {
            Some(nome) if !nome.trim().is_empty() => nome,
            _ => return Err("escolha uma impressora antes de imprimir".into()),
        };

        // A lista vai em arquivo porque mil folhas estourariam o limite de
        // tamanho da linha de comando do Windows.
        let lista = pasta.join("folhas.txt");
        let corpo: Vec<String> = folhas
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        fs::write(&lista, corpo.join("\n")).map_err(|e| e.to_string())?;

        // A janela do driver, quando pedida, vem antes do envio: e dela que
        // sai o DEVMODE com tipo de papel, bandeja e qualidade.
        let mut modo: Option<String> = None;
        if opcoes.usar_dialogo == Some(true) {
            let escolha = chamar(
                app,
                &[
                    "configurar".into(),
                    "--impressora".into(),
                    impressora.clone(),
                ],
            )?;
            if escolha.get("cancelado").and_then(Value::as_bool) == Some(true) {
                return Ok(json!({ "ok": true, "cancelado": true }));
            }
            modo = escolha
                .get("modo")
                .and_then(Value::as_str)
                .map(str::to_string);
        }

        let mut argumentos: Vec<String> = vec![
            "imprimir".into(),
            "--impressora".into(),
            impressora,
            "--paginas".into(),
            lista.to_string_lossy().to_string(),
            "--papel".into(),
            codigo_do_papel(opcoes.papel.as_deref().unwrap_or("A4")).to_string(),
        ];

        if let Some(modo) = modo {
            argumentos.push("--modo".into());
            argumentos.push(modo);
        }
        if let Some(copias) = opcoes.copias.filter(|c| *c > 1) {
            argumentos.push("--copias".into());
            argumentos.push(copias.to_string());
        }
        if opcoes.paisagem == Some(true) {
            argumentos.push("--paisagem".into());
        }
        if let Some(colorido) = opcoes.colorido {
            argumentos.push("--cor".into());
            argumentos.push(if colorido { "1".into() } else { "0".into() });
        }
        if let Some(duplex) = opcoes.duplex.filter(|d| !d.is_empty()) {
            argumentos.push("--duplex".into());
            argumentos.push(duplex);
        }
        if let Some(titulo) = nome {
            argumentos.push("--titulo".into());
            argumentos.push(titulo);
        }
        if let Some(arquivo) = opcoes.arquivo.filter(|a| !a.trim().is_empty()) {
            argumentos.push("--arquivo".into());
            argumentos.push(arquivo);
        }

        let mut resposta = chamar(app, &argumentos)?;
        if let Some(objeto) = resposta.as_object_mut() {
            objeto.insert("ok".into(), json!(true));
            objeto.insert("folhas".into(), json!(folhas.len()));
        }
        Ok(resposta)
    }
}

fn numero_da_folha(caminho: &std::path::Path) -> u32 {
    caminho
        .file_stem()
        .and_then(|s| s.to_str())
        .and_then(|s| s.parse().ok())
        .unwrap_or(u32::MAX)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn folhas_saem_na_ordem_do_numero() {
        let mut folhas: Vec<PathBuf> = ["10000.jpg", "9999.jpg", "0002.jpg", "0001.jpg"]
            .iter()
            .map(PathBuf::from)
            .collect();
        folhas.sort_by_key(|p| numero_da_folha(p));
        let nomes: Vec<_> = folhas.iter().map(|p| p.to_string_lossy().to_string()).collect();
        assert_eq!(nomes, ["0001.jpg", "0002.jpg", "9999.jpg", "10000.jpg"]);
    }

    #[test]
    fn papel_desconhecido_cai_no_a4() {
        assert_eq!(codigo_do_papel("A4"), 9);
        assert_eq!(codigo_do_papel("A3"), 8);
        assert_eq!(codigo_do_papel("Letter"), 1);
        assert_eq!(codigo_do_papel("qualquer"), 9);
    }

    #[test]
    fn sessao_guarda_e_descarta_as_folhas() {
        let sessoes = Sessoes::default();
        let preparada = sessoes.preparar().unwrap();
        sessoes.pagina(&preparada.id, 1, vec![1, 2, 3]).unwrap();
        let pasta = sessoes.pasta(&preparada.id).unwrap();
        assert!(pasta.join("0001.jpg").exists());

        sessoes.descartar(&preparada.id).unwrap();
        assert!(!pasta.exists());
        assert!(sessoes.pagina(&preparada.id, 2, vec![]).is_err());
    }

    #[test]
    fn a_mesma_sessao_nao_sai_duas_vezes() {
        // O Tauri reenvia o comando quando o pedido cai no meio: a segunda
        // chegada nao pode achar a sessao, senao a tiragem sai em dobro.
        let sessoes = Sessoes::default();
        let preparada = sessoes.preparar().unwrap();
        sessoes.pagina(&preparada.id, 1, vec![1]).unwrap();

        let primeira = sessoes.tomar(&preparada.id).expect("a primeira leva a sessao");
        let pasta = primeira.0.clone();
        assert!(pasta.join("0001.jpg").exists());
        assert!(sessoes.tomar(&preparada.id).is_err(), "a segunda nao pode achar nada");

        drop(primeira);
        assert!(!pasta.exists(), "as folhas somem quando o envio acaba");
    }
}

/// Roda o auxiliar e devolve o JSON dele.
pub fn chamar(app: &AppHandle, argumentos: &[String]) -> Result<Value, String> {
    let exe = recursos(app)?.join("impressora").join("impressora.exe");
    if !exe.exists() {
        return Err(format!(
            "nao achei o auxiliar de impressao em {}",
            exe.to_string_lossy()
        ));
    }

    let mut comando = Command::new(&exe);
    comando
        .args(argumentos)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    comando.creation_flags(SEM_JANELA);

    let filho = comando
        .spawn()
        .map_err(|e| format!("nao consegui rodar o auxiliar de impressao: {e}"))?;
    // Preso ao aplicativo: esperando o "Salvar como" de uma impressora
    // virtual, ele sobrevivia ao fechamento e ficava para tras, invisivel.
    crate::processos::prender(&filho);
    let saida = filho
        .wait_with_output()
        .map_err(|e| format!("o auxiliar de impressao parou no meio: {e}"))?;

    if !saida.status.success() {
        let motivo = String::from_utf8_lossy(&saida.stderr);
        // O auxiliar avisa o motivo em JSON; qualquer outra coisa vale como
        // texto solto, que ainda e melhor que "falhou".
        let explicado = serde_json::from_str::<Value>(motivo.trim())
            .ok()
            .and_then(|v| {
                v.get("erro")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
        return Err(explicado.unwrap_or_else(|| {
            if motivo.trim().is_empty() {
                "o auxiliar de impressao falhou".into()
            } else {
                motivo.trim().to_string()
            }
        }));
    }

    let texto = String::from_utf8_lossy(&saida.stdout);
    serde_json::from_str(texto.trim())
        .map_err(|e| format!("o auxiliar respondeu algo que nao entendi: {e}"))
}
