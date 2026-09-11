//! Gravar arquivos no disco sem perder o que ja estava la.

use std::fs;
use std::path::{Path, PathBuf};

/// Tira do nome o que o Windows recusa, para o arquivo nunca deixar de salvar.
///
/// Serve tambem de tranca: o nome chega da interface e nunca pode virar
/// caminho, senao uma barra no nome escreveria fora da pasta escolhida.
pub fn nome_seguro(nome: &str) -> String {
    let limpo: String = nome
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c if (c as u32) < 32 => '-',
            c => c,
        })
        .collect();
    let limpo = limpo.trim().trim_end_matches('.').to_string();
    if limpo.is_empty() {
        "arquivo".into()
    } else {
        limpo
    }
}

/// O primeiro nome livre: "conta.pdf", depois "conta (2).pdf".
///
/// Sobrescrever calado ja custou o arquivo de alguem que rodou a mesma
/// ferramenta duas vezes achando que a primeira nao tinha funcionado.
pub fn caminho_livre(pasta: &Path, nome: &str) -> PathBuf {
    let nome = nome_seguro(nome);
    let alvo = pasta.join(&nome);
    if !alvo.exists() {
        return alvo;
    }

    let caule = Path::new(&nome)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("arquivo")
        .to_string();
    let extensao = Path::new(&nome)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();

    for n in 2..10_000 {
        let tentativa = pasta.join(format!("{caule} ({n}){extensao}"));
        if !tentativa.exists() {
            return tentativa;
        }
    }
    pasta.join(format!("{caule} ({}){extensao}", std::process::id()))
}

pub fn gravar(caminho: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(pai) = caminho.parent() {
        fs::create_dir_all(pai).map_err(|e| e.to_string())?;
    }
    fs::write(caminho, bytes).map_err(|e| format!("nao consegui gravar: {e}"))
}

#[cfg(test)]
mod testes {
    use super::*;

    fn pasta_de_teste(nome: &str) -> PathBuf {
        let pasta = std::env::temp_dir().join(format!("greencodes-teste-{nome}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&pasta);
        fs::create_dir_all(&pasta).unwrap();
        pasta
    }

    #[test]
    fn nome_nunca_vira_caminho() {
        // A barra no nome escreveria fora da pasta escolhida.
        let limpo = nome_seguro(r"..\..\Windows\system32\x.pdf");
        assert!(!limpo.contains('\\') && !limpo.contains('/'), "{limpo}");
        assert!(!nome_seguro("../../x.pdf").contains('/'));
        assert!(!nome_seguro("C:x.pdf").contains(':'));
    }

    #[test]
    fn nome_vazio_ou_so_de_pontos_vira_arquivo() {
        assert_eq!(nome_seguro(""), "arquivo");
        assert_eq!(nome_seguro("   "), "arquivo");
        assert_eq!(nome_seguro("..."), "arquivo");
    }

    #[test]
    fn acento_passa_intacto() {
        assert_eq!(nome_seguro("Relatório de impressão.pdf"), "Relatório de impressão.pdf");
    }

    #[test]
    fn caminho_livre_nunca_sobrescreve() {
        let pasta = pasta_de_teste("livre");
        let primeiro = caminho_livre(&pasta, "conta.pdf");
        assert_eq!(primeiro, pasta.join("conta.pdf"));
        gravar(&primeiro, b"1").unwrap();

        let segundo = caminho_livre(&pasta, "conta.pdf");
        assert_eq!(segundo, pasta.join("conta (2).pdf"));
        gravar(&segundo, b"2").unwrap();

        assert_eq!(caminho_livre(&pasta, "conta.pdf"), pasta.join("conta (3).pdf"));
        assert_eq!(fs::read(&primeiro).unwrap(), b"1");
        let _ = fs::remove_dir_all(pasta);
    }

    #[test]
    fn gravar_cria_a_pasta_que_falta() {
        let pasta = pasta_de_teste("gravar");
        let alvo = pasta.join("a").join("b").join("c.pdf");
        gravar(&alvo, b"%PDF").unwrap();
        assert_eq!(fs::read(&alvo).unwrap(), b"%PDF");
        let _ = fs::remove_dir_all(pasta);
    }
}

/// Como o dialogo de salvar chama cada tipo de arquivo.
pub fn rotulo_da_extensao(extensao: &str) -> &'static str {
    match extensao {
        "zip" => "Arquivo compactado",
        "jpg" | "jpeg" => "Imagem JPEG",
        "png" => "Imagem PNG",
        "webp" => "Imagem WebP",
        "txt" => "Texto",
        "docx" => "Documento do Word",
        "xlsx" => "Planilha do Excel",
        "csv" => "Planilha em texto",
        _ => "Documento PDF",
    }
}
