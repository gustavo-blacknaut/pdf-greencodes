//! Onde os resultados sao gravados, e o que se apaga sozinho.
//!
//! Tudo vai **solto na pasta Downloads**, com um nome de numero longo como os
//! IDs do Discord (`1289473829384756224.pdf`). Solto porque e onde a pessoa
//! procura primeiro, sem abrir subpasta; numero porque nunca repete, e em
//! ordem de criacao: o mais novo e sempre o de numero maior. Decisao do
//! Gustavo (2026-09-11) - antes era `Downloads/PDF.GreenCodes/1.pdf`.
//!
//! A auto-exclusao e opcional e por arquivo: quem marcou entra num registro
//! com a hora de morrer, e uma varredura periodica apaga o que passou do
//! prazo. Com os arquivos soltos em Downloads, a varredura so apaga o que ela
//! mesma registrou **e** tem nome de ID nosso: um registro estragado nao vira
//! permissao para apagar o arquivo de mais ninguem.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const UM_DIA: u64 = 24 * 60 * 60 * 1000;
const INTERVALO_DA_VARREDURA: Duration = Duration::from_secs(60 * 60);

/// A mesma epoca do Discord (1/1/2015): e o que da IDs de 18 e 19 digitos.
const EPOCA: u64 = 1_420_070_400_000;

#[derive(Serialize, Deserialize, Clone)]
struct Marcado {
    caminho: String,
    #[serde(rename = "apagarEm")]
    apagar_em: u64,
}

fn agora() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Um ID no formato "snowflake", o mesmo desenho dos IDs do Discord.
///
/// 42 bits de milissegundo desde 2015, 10 bits que mudam de um processo para
/// outro e 12 bits de contador. Dois arquivos no mesmo milissegundo ganham
/// contadores diferentes; dois programas abertos ao mesmo tempo, os 10 bits
/// do meio diferentes. E sempre crescente, entao ordenar por nome e ordenar
/// por data.
pub fn novo_id() -> u64 {
    static ULTIMO: AtomicU64 = AtomicU64::new(0);
    let maquina = (std::process::id() as u64 ^ (agora() >> 3)) & 0x3FF;

    loop {
        let base = (agora().saturating_sub(EPOCA) << 22) | (maquina << 12);
        let anterior = ULTIMO.load(Ordering::SeqCst);
        // Relogio parado ou voltando: segue do ultimo, nunca repete.
        let candidato = if base > anterior { base } else { anterior + 1 };
        if ULTIMO
            .compare_exchange(anterior, candidato, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            return candidato;
        }
    }
}

/// O nome tem cara de ID nosso: so digitos, do tamanho de um snowflake.
fn e_nome_de_id(caminho: &Path) -> bool {
    caminho
        .file_stem()
        .and_then(|s| s.to_str())
        .is_some_and(|s| (15..=20).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()))
}

/// A pasta dos resultados: a propria Downloads.
pub fn pasta(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .download_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|e| format!("nao achei a pasta de downloads: {e}"))?;
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base)
}

/// O caminho livre para um resultado novo, com a extensao do nome pedido.
pub fn destino_novo(pasta: &Path, nome: &str) -> PathBuf {
    let extensao = Path::new(nome)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_lowercase()))
        .unwrap_or_else(|| ".pdf".into());
    loop {
        let tentativa = pasta.join(format!("{}{extensao}", novo_id()));
        if !tentativa.exists() {
            return tentativa;
        }
    }
}

fn registro(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("nao achei a pasta de dados: {e}"))?;
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base.join("auto-exclusao.json"))
}

/// Registro ausente ou estragado e o mesmo que registro vazio: nada para
/// apagar e sempre a resposta segura.
fn ler(app: &AppHandle) -> Vec<Marcado> {
    let Ok(arquivo) = registro(app) else {
        return Vec::new();
    };
    let Ok(texto) = fs::read_to_string(arquivo) else {
        return Vec::new();
    };
    serde_json::from_str(&texto).unwrap_or_default()
}

fn gravar(app: &AppHandle, itens: &[Marcado]) -> Result<(), String> {
    let arquivo = registro(app)?;
    let texto = serde_json::to_string_pretty(itens).map_err(|e| e.to_string())?;
    fs::write(arquivo, texto).map_err(|e| e.to_string())
}

/// Grava o resultado solto em Downloads, com nome de ID.
///
/// Sem dialogo e sem sobrescrever nada. Quem processa varios documentos
/// seguidos nao quer decidir nome e pasta a cada um.
pub fn salvar(
    app: &AppHandle,
    nome: &str,
    bytes: &[u8],
    apagar_em_1_dia: bool,
) -> Result<PathBuf, String> {
    let destino = destino_novo(&pasta(app)?, nome);
    crate::arquivos::gravar(&destino, bytes)?;
    if apagar_em_1_dia {
        marcar(app, &destino.to_string_lossy())?;
    }
    Ok(destino)
}

/// Leva para Downloads um arquivo que o motor ja gravou no disco.
///
/// E o caminho dos arquivos grandes: o resultado de 2 GB nao atravessa a
/// janela, so muda de pasta. No mesmo disco e so renomear, instantaneo; entre
/// discos, copia e apaga a original.
pub fn entregar(app: &AppHandle, origem: &Path) -> Result<PathBuf, String> {
    let nome = origem
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("resultado.pdf");
    let destino = destino_novo(&pasta(app)?, nome);
    if fs::rename(origem, &destino).is_err() {
        fs::copy(origem, &destino).map_err(|e| format!("nao consegui levar o resultado para Downloads: {e}"))?;
        let _ = fs::remove_file(origem);
    }
    Ok(destino)
}

pub fn marcar(app: &AppHandle, caminho: &str) -> Result<(), String> {
    let mut itens: Vec<Marcado> = ler(app)
        .into_iter()
        .filter(|item| item.caminho != caminho)
        .collect();
    itens.push(Marcado {
        caminho: caminho.to_string(),
        apagar_em: agora() + UM_DIA,
    });
    gravar(app, &itens)
}

/// Tira a marca sem apagar o arquivo.
pub fn manter(app: &AppHandle, caminho: &str) -> Result<(), String> {
    let itens: Vec<Marcado> = ler(app)
        .into_iter()
        .filter(|item| item.caminho != caminho)
        .collect();
    gravar(app, &itens)
}

/// So entra na varredura o que esta direto na pasta dos resultados e tem nome
/// de ID nosso. Nada em subpasta, nada com nome escolhido por gente.
fn pode_apagar(alvo: &Path, nossa: &Path) -> bool {
    alvo.parent() == Some(nossa) && e_nome_de_id(alvo)
}

/// Apaga o que passou do prazo e limpa o registro.
///
/// Some do registro tambem o que ja nao existe - arquivo que a pessoa moveu
/// ou apagou a mao nao deveria ficar sendo procurado para sempre.
pub fn varrer(app: &AppHandle) -> (usize, usize) {
    let itens = ler(app);
    if itens.is_empty() {
        return (0, 0);
    }
    let Ok(nossa) = pasta(app) else {
        return (0, itens.len());
    };

    let mut ficam = Vec::new();
    let mut apagados = 0usize;
    let agora = agora();

    for item in itens {
        let alvo = PathBuf::from(&item.caminho);
        if !pode_apagar(&alvo, &nossa) {
            continue;
        }

        if agora < item.apagar_em {
            if alvo.exists() {
                ficam.push(item);
            }
            continue;
        }

        // Arquivo aberto em outro programa nao apaga agora; fica para a
        // proxima varredura em vez de sumir do registro sem ter sido apagado.
        match fs::remove_file(&alvo) {
            Ok(()) => apagados += 1,
            Err(_) if !alvo.exists() => {}
            Err(_) => ficam.push(item),
        }
    }

    let restantes = ficam.len();
    let _ = gravar(app, &ficam);
    (apagados, restantes)
}

/// Varre agora e de hora em hora enquanto o aplicativo estiver aberto.
pub fn iniciar_varredura(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        varrer(&app);
        std::thread::sleep(INTERVALO_DA_VARREDURA);
    });
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn o_id_tem_cara_de_discord_e_nunca_repete() {
        let ids: Vec<u64> = (0..5000).map(|_| novo_id()).collect();
        for par in ids.windows(2) {
            assert!(par[1] > par[0], "o ID tem que crescer sempre");
        }
        let texto = ids[0].to_string();
        assert!((18..=19).contains(&texto.len()), "{texto} nao tem o tamanho de um ID do Discord");
    }

    #[test]
    fn o_id_guarda_a_hora_em_que_nasceu() {
        let antes = agora();
        let id = novo_id();
        let nascido = (id >> 22) + EPOCA;
        assert!(nascido >= antes.saturating_sub(5) && nascido <= agora() + 5);
    }

    #[test]
    fn destino_novo_nunca_reaproveita_nome() {
        let pasta = std::env::temp_dir().join(format!("greencodes-ids-{}", std::process::id()));
        fs::create_dir_all(&pasta).unwrap();
        let a = destino_novo(&pasta, "contrato.PDF");
        fs::write(&a, b"1").unwrap();
        let b = destino_novo(&pasta, "contrato.pdf");
        assert_ne!(a, b);
        assert_eq!(a.extension().unwrap(), "pdf");
        assert!(e_nome_de_id(&a));
        let _ = fs::remove_dir_all(pasta);
    }

    #[test]
    fn a_varredura_so_apaga_arquivo_nosso() {
        let downloads = Path::new(r"C:\Users\alguem\Downloads");
        assert!(pode_apagar(&downloads.join("1289473829384756224.pdf"), downloads));
        // O arquivo da pessoa, com nome dela, nunca.
        assert!(!pode_apagar(&downloads.join("contrato.pdf"), downloads));
        assert!(!pode_apagar(&downloads.join("2024.pdf"), downloads));
        // Nem em subpasta, nem fora de Downloads.
        assert!(!pode_apagar(&downloads.join("fotos").join("1289473829384756224.pdf"), downloads));
        assert!(!pode_apagar(Path::new(r"C:\Windows\1289473829384756224.dll"), downloads));
    }
}
