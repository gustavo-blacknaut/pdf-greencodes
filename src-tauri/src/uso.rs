//! O que a pessoa ja fez no programa, em numeros.
//!
//! Quantas vezes juntou, quantas impressoes mandou, quantas folhas, quantos
//! arquivos salvou. **So quantidade**: nenhum nome de arquivo, nenhum texto,
//! nenhum conteudo - pedido do Gustavo (2026-09-11). Fica num JSON na pasta
//! de dados do aplicativo, no computador, e nao vai para lugar nenhum.
//!
//! A garantia nao depende da tela se comportar: o identificador de ferramenta
//! so e aceito se for um slug (`juntar-pdf`), entao nem por engano um nome de
//! arquivo ou um trecho de documento consegue entrar no registro.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Default, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Uso {
    /// Quando a contagem comecou, em milissegundos.
    pub desde: u64,
    /// Vezes que cada ferramenta rodou ate o fim, pelo slug.
    pub ferramentas: BTreeMap<String, u64>,
    pub arquivos_processados: u64,
    pub paginas_processadas: u64,
    pub bytes_processados: u64,
    /// Trabalhos mandados para a impressora.
    pub impressoes: u64,
    /// Folhas que sairam, ja contando as copias.
    pub folhas_impressas: u64,
    /// Arquivos que o programa gravou no disco.
    pub arquivos_salvos: u64,
}

/// O que a tela conta. Cada campo e um numero, fora o slug.
#[derive(Deserialize, Debug)]
#[serde(tag = "tipo", rename_all = "camelCase")]
pub enum Evento {
    #[serde(rename_all = "camelCase")]
    Ferramenta {
        slug: String,
        #[serde(default)]
        arquivos: u64,
        #[serde(default)]
        paginas: u64,
        #[serde(default)]
        bytes: u64,
    },
    #[serde(rename_all = "camelCase")]
    Impressao { folhas: u64, copias: u64 },
}

/// Slug de ferramenta: letras minusculas, digitos e hifen, curto.
pub fn e_slug(texto: &str) -> bool {
    !texto.is_empty()
        && texto.len() <= 40
        && texto.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

impl Uso {
    pub fn contar(&mut self, evento: Evento, agora: u64) -> Result<(), String> {
        if self.desde == 0 {
            self.desde = agora;
        }
        match evento {
            Evento::Ferramenta { slug, arquivos, paginas, bytes } => {
                if !e_slug(&slug) {
                    return Err("identificador de ferramenta invalido".into());
                }
                *self.ferramentas.entry(slug).or_insert(0) += 1;
                self.arquivos_processados = self.arquivos_processados.saturating_add(arquivos);
                self.paginas_processadas = self.paginas_processadas.saturating_add(paginas);
                self.bytes_processados = self.bytes_processados.saturating_add(bytes);
            }
            Evento::Impressao { folhas, copias } => {
                self.impressoes += 1;
                self.folhas_impressas = self
                    .folhas_impressas
                    .saturating_add(folhas.saturating_mul(copias.max(1)));
            }
        }
        Ok(())
    }
}

/// O registro em memoria, e o cadeado que impede duas gravacoes cruzadas.
#[derive(Default)]
pub struct Registro(Mutex<Option<Uso>>);

fn arquivo(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("nao achei a pasta de dados: {e}"))?;
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base.join("uso.json"))
}

fn agora() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl Registro {
    fn com<T>(&self, app: &AppHandle, fazer: impl FnOnce(&mut Uso) -> Result<T, String>) -> Result<T, String> {
        let mut guarda = self.0.lock().map_err(|_| "registro de uso travado")?;
        if guarda.is_none() {
            // Registro estragado vale como vazio: contar de novo e melhor
            // que o programa nao abrir.
            let lido = arquivo(app)
                .ok()
                .and_then(|a| fs::read_to_string(a).ok())
                .and_then(|t| serde_json::from_str(&t).ok())
                .unwrap_or_default();
            *guarda = Some(lido);
        }
        let uso = guarda.as_mut().expect("carregado acima");
        let resposta = fazer(uso)?;
        let texto = serde_json::to_string_pretty(uso).map_err(|e| e.to_string())?;
        fs::write(arquivo(app)?, texto).map_err(|e| e.to_string())?;
        Ok(resposta)
    }

    pub fn registrar(&self, app: &AppHandle, evento: Evento) -> Result<(), String> {
        self.com(app, |uso| uso.contar(evento, agora()))
    }

    pub fn salvou(&self, app: &AppHandle, quantos: u64) {
        let _ = self.com(app, |uso| {
            if uso.desde == 0 {
                uso.desde = agora();
            }
            uso.arquivos_salvos = uso.arquivos_salvos.saturating_add(quantos);
            Ok(())
        });
    }

    pub fn ler(&self, app: &AppHandle) -> Result<Uso, String> {
        self.com(app, |uso| Ok(uso.clone()))
    }

    pub fn zerar(&self, app: &AppHandle) -> Result<Uso, String> {
        self.com(app, |uso| {
            *uso = Uso { desde: agora(), ..Uso::default() };
            Ok(uso.clone())
        })
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn conta_ferramenta_e_impressao() {
        let mut uso = Uso::default();
        uso.contar(Evento::Ferramenta { slug: "juntar-pdf".into(), arquivos: 3, paginas: 40, bytes: 900 }, 10)
            .unwrap();
        uso.contar(Evento::Ferramenta { slug: "juntar-pdf".into(), arquivos: 2, paginas: 5, bytes: 100 }, 20)
            .unwrap();
        uso.contar(Evento::Impressao { folhas: 12, copias: 3 }, 30).unwrap();

        assert_eq!(uso.ferramentas["juntar-pdf"], 2);
        assert_eq!(uso.arquivos_processados, 5);
        assert_eq!(uso.paginas_processadas, 45);
        assert_eq!(uso.impressoes, 1);
        assert_eq!(uso.folhas_impressas, 36, "12 folhas em 3 copias sao 36");
        assert_eq!(uso.desde, 10, "comeca na primeira contagem, e nao muda");
    }

    #[test]
    fn nome_de_arquivo_nunca_entra() {
        let mut uso = Uso::default();
        for tentativa in ["contrato-joao.pdf", "C:\\Users\\x\\a.pdf", "Juntar PDF", "senha 1234", ""] {
            let recusado = uso.contar(
                Evento::Ferramenta { slug: tentativa.into(), arquivos: 1, paginas: 1, bytes: 1 },
                1,
            );
            assert!(recusado.is_err(), "{tentativa:?} entrou no registro");
        }
        assert!(uso.ferramentas.is_empty());
        assert_eq!(uso.arquivos_processados, 0);
    }

    #[test]
    fn o_json_so_tem_numero_e_slug() {
        let mut uso = Uso::default();
        uso.contar(Evento::Ferramenta { slug: "comprimir-pdf".into(), arquivos: 1, paginas: 2, bytes: 3 }, 5)
            .unwrap();
        let texto = serde_json::to_string(&uso).unwrap();
        assert_eq!(
            texto,
            r#"{"desde":5,"ferramentas":{"comprimir-pdf":1},"arquivosProcessados":1,"paginasProcessadas":2,"bytesProcessados":3,"impressoes":0,"folhasImpressas":0,"arquivosSalvos":0}"#
        );
    }

    #[test]
    fn evento_chega_da_tela_no_formato_combinado() {
        let evento: Evento =
            serde_json::from_str(r#"{"tipo":"impressao","folhas":4,"copias":2}"#).unwrap();
        let mut uso = Uso::default();
        uso.contar(evento, 1).unwrap();
        assert_eq!(uso.folhas_impressas, 8);
    }
}
